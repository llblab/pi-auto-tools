#!/usr/bin/env node

/**
 * Detached async-runner executable.
 *
 * Owns the run child-process control loop directly. Reusable runtime
 * primitives stay in lib/; this script should remain understandable without
 * chasing a one-off lib entrypoint domain.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function packageRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

async function importRuntimeModule(name) {
  const root = packageRoot();
  const compiled = join(root, "dist", "lib", `${name}.js`);
  const source = join(root, "lib", `${name}.ts`);
  return await import(
    pathToFileURL(existsSync(compiled) ? compiled : source).href
  );
}

const {
  appendRecipeContextToPiArgs,
  attachPiSessionDir,
  materializePiPrintPromptArg,
} = await importRuntimeModule("recipes-context");
const { buildReviewPreflightDiagnostic, formatReviewPreflightDiagnostic } =
  await importRuntimeModule("preflight-diagnostics");
const { execCommandTemplate } = await importRuntimeModule("command-templates");
const { applyOutputAcceptancePolicy, executeRegisteredTool } =
  await importRuntimeModule("execution");
const { writeJsonAtomic } = await importRuntimeModule("file-state");
const { appendRunTraceEvent } = await importRuntimeModule("runs-trace");

function quoteCommandDetailPart(value) {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_/:=.,@%+\-]+$/.test(value)) return value;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function formatCommandDetail(command, args) {
  return [command, ...args].map(quoteCommandDetailPart).join(" ");
}

function captureDetails(result) {
  return {
    ...(typeof result.stdoutBytes === "number" ? { stdout_bytes: result.stdoutBytes } : {}),
    ...(typeof result.stderrBytes === "number" ? { stderr_bytes: result.stderrBytes } : {}),
    ...(result.stdoutFile ? { stdout_file: result.stdoutFile } : {}),
    ...(result.stderrFile ? { stderr_file: result.stderrFile } : {}),
    ...(result.stdoutTruncated ? { stdout_truncated: true } : {}),
    ...(result.stderrTruncated ? { stderr_truncated: true } : {}),
  };
}

function summarizeCommandDetail(commandDetail) {
  return commandDetail.length > 160
    ? `${commandDetail.slice(0, 157)}...`
    : commandDetail;
}

export async function runAsyncRunner(stateDir = process.argv[2]) {
  if (!stateDir) throw new Error("missing state dir");
  const runPath = join(stateDir, "run.json");
  const progressPath = join(stateDir, "progress.json");
  const resultPath = join(stateDir, "result.json");
  const tracePath = join(stateDir, "trace.jsonl");
  const stdoutPath = join(stateDir, "stdout.log");
  const stderrPath = join(stateDir, "stderr.log");
  const executionPath = join(stateDir, "execution.json");
  const meta = JSON.parse(readFileSync(runPath, "utf8"));
  function event(kind, data = {}) {
    appendRunTraceEvent(stateDir, { kind, data });
  }
  function observation(kind, summary, data = {}, delivery = "log", level = "info") {
    appendRunTraceEvent(stateDir, {
      kind,
      summary,
      data,
      ...(delivery === "followup" ? { attention: "followup" } : {}),
      ...(level === "error" ? { level: "error" } : {}),
    });
  }
  function progress(phase, extra = {}) {
    writeJsonAtomic(progressPath, {
      ...(meta.model_policy ? { model_policy: meta.model_policy } : {}),
      phase,
      updatedAt: new Date().toISOString(),
      ...extra,
    });
  }
  let activeSubagents = 0;
  let completedSubagents = 0;
  let promptCounter = 0;
  let captureCounter = 0;
  const subagentFailures = [];
  const evidenceRecords = [];
  const stageOccurrences = new Map();
  let reportEvidence;
  function writeExecutionManifest(status) {
    writeJsonAtomic(executionPath, {
      version: 1,
      run: meta.run,
      status,
      ...(meta.model_policy ? { model_policy: meta.model_policy } : {}),
      commands: [...evidenceRecords].sort((left, right) =>
        left.id.localeCompare(right.id)
      ),
      ...(reportEvidence ? { report_evidence: reportEvidence } : {}),
      updated_at: new Date().toISOString(),
    });
  }
  function commandSessionFiles(sessionDir) {
    if (!sessionDir) return [];
    try {
      return readdirSync(sessionDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => relative(stateDir, join(sessionDir, entry.name)).replaceAll("\\", "/"))
        .sort();
    } catch {
      return [];
    }
  }
  function commandEvidenceStartRecord({
    commandDetail,
    commandId,
    materialized,
    options,
    sessionDir,
    stage,
    occurrence,
  }) {
    const recipeContext = options?.actorRecipeContext;
    return {
      id: commandId,
      stage,
      occurrence,
      status: "running",
      started_at: new Date().toISOString(),
      ...(options?.evidenceContext?.label
        ? { label: options.evidenceContext.label }
        : {}),
      ...(options?.evidenceContext?.repeatIndex !== undefined
        ? { branch_index: options.evidenceContext.repeatIndex }
        : {}),
      ...(recipeContext ? { recipe_context: recipeContext } : {}),
      command: commandDetail,
      ...(materialized.promptFile
        ? { prompt_file: relative(stateDir, materialized.promptFile).replaceAll("\\", "/") }
        : {}),
      ...(materialized.promptBytes
        ? { prompt_bytes: materialized.promptBytes }
        : {}),
      ...(sessionDir ? { session_dir: relative(stateDir, sessionDir).replaceAll("\\", "/") } : {}),
      attempts: [],
      semantic_acceptance:
        options?.evidenceContext?.acceptOutput === "review_evidence" ||
        stage === "preflight"
          ? "pending"
          : "not_required",
    };
  }
  function commandEvidenceRecord({
    captureDir,
    commandDetail,
    commandId,
    materialized,
    options,
    result,
    rawExitCode,
    sessionDir,
    stage,
    occurrence,
    startedAt,
  }) {
    const recipeContext = options?.actorRecipeContext;
    const attempts = [];
    const maxAttempts = Math.max(1, options?.retry || 1);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptDir = join(
        captureDir,
        `attempt-${String(attempt).padStart(3, "0")}`,
      );
      const stdoutFile = join(attemptDir, "stdout.log");
      const stderrFile = join(attemptDir, "stderr.log");
      if (!existsSync(stdoutFile) && !existsSync(stderrFile)) continue;
      attempts.push({
        attempt,
        stdout: {
          path: relative(stateDir, stdoutFile).replaceAll("\\", "/"),
          bytes: existsSync(stdoutFile) ? statSync(stdoutFile).size : 0,
        },
        stderr: {
          path: relative(stateDir, stderrFile).replaceAll("\\", "/"),
          bytes: existsSync(stderrFile) ? statSync(stderrFile).size : 0,
        },
      });
    }
    const expectedReviewMarker =
      options?.evidenceContext?.acceptOutput === "review_evidence";
    const expectedPreflightMarker = stage === "preflight";
    const semanticStdout = result.stdoutTruncated && result.stdoutFile && existsSync(result.stdoutFile)
      ? readFileSync(result.stdoutFile, "utf8")
      : result.stdout;
    const firstNonWhitespaceLine = semanticStdout
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0);
    const markerAccepted = expectedReviewMarker
      ? firstNonWhitespaceLine?.trim() === "ACTOR_REVIEW_RESULT"
      : expectedPreflightMarker
        ? result.stdout.trimStart().startsWith("ACTOR_PREFLIGHT_OK")
        : undefined;
    return {
      id: commandId,
      stage,
      occurrence,
      status: result.code === 0 ? "done" : "failed",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      ...(options?.evidenceContext?.label
        ? { label: options.evidenceContext.label }
        : {}),
      ...(options?.evidenceContext?.repeatIndex !== undefined
        ? { branch_index: options.evidenceContext.repeatIndex }
        : {}),
      ...(recipeContext ? { recipe_context: recipeContext } : {}),
      command: commandDetail,
      ...(materialized.promptFile
        ? { prompt_file: relative(stateDir, materialized.promptFile).replaceAll("\\", "/") }
        : {}),
      ...(materialized.promptBytes
        ? { prompt_bytes: materialized.promptBytes }
        : {}),
      ...(sessionDir ? { session_dir: relative(stateDir, sessionDir).replaceAll("\\", "/") } : {}),
      ...(commandSessionFiles(sessionDir).length > 0
        ? { session_files: commandSessionFiles(sessionDir) }
        : {}),
      attempts,
      exit_code: rawExitCode ?? result.code,
      effective_exit_code: result.code,
      killed: result.killed,
      stdout_bytes: result.stdoutBytes ?? Buffer.byteLength(result.stdout),
      stderr_bytes: result.stderrBytes ?? Buffer.byteLength(result.stderr),
      stdout_truncated: result.stdoutTruncated === true,
      stderr_truncated: result.stderrTruncated === true,
      semantic_acceptance:
        markerAccepted === undefined
          ? "not_required"
          : markerAccepted && result.code === 0
            ? "accepted"
            : "rejected",
    };
  }
  function auditReviewReport(text) {
    const required = evidenceRecords
      .filter((record) =>
        ["reviewer", "verifier", "merger", "judge"].includes(record.stage)
      )
      .map((record) => `execution.json#${record.id}`);
    if (required.length === 0) return undefined;
    const cited = [...new Set(
      text.match(/execution\.json#command-\d{3}/g) || [],
    )].sort();
    const missing = required.filter((reference) => !cited.includes(reference));
    const claimsComplete = /\bStatus\b[\s:*#_-]{0,40}\bcomplete\b/i.test(text);
    return {
      required,
      cited,
      missing,
      claims_complete: claimsComplete,
      complete_allowed: missing.length === 0,
    };
  }
  function progressRunning() {
    progress("running", {
      activeSubagents,
      completed: completedSubagents,
      failures: subagentFailures,
    });
  }
  function promptFilePath() {
    promptCounter += 1;
    const dir = join(stateDir, "prompts");
    mkdirSync(dir, { recursive: true });
    return join(dir, `command-${String(promptCounter).padStart(3, "0")}.md`);
  }
  function readPromptText(promptFile) {
    if (!promptFile) return undefined;
    try {
      return readFileSync(promptFile, "utf8");
    } catch {
      return undefined;
    }
  }
  async function observedExec(command, args, options) {
    captureCounter += 1;
    const commandId = `command-${String(captureCounter).padStart(3, "0")}`;
    const contextArgs = appendRecipeContextToPiArgs(
      command,
      args,
      meta.recipe_context_records,
      options?.actorRecipeContext,
    );
    const session = attachPiSessionDir(
      command,
      contextArgs,
      join(stateDir, "sessions", commandId),
    );
    const materialized = materializePiPrintPromptArg(
      command,
      session.args,
      promptFilePath,
    );
    const execArgs = materialized.args;
    const commandDetail = formatCommandDetail(command, execArgs);
    const stage =
      options?.actorRecipeContext?.alias ||
      options?.actorRecipeContext?.name ||
      "command";
    const occurrence = (stageOccurrences.get(stage) || 0) + 1;
    stageOccurrences.set(stage, occurrence);
    if (
      materialized.promptFile &&
      ["verifier", "merger", "judge", "normalizer"].includes(stage)
    ) {
      const references = evidenceRecords
        .filter((record) =>
          ["reviewer", "verifier", "merger", "judge"].includes(record.stage)
        )
        .map((record) => `ACTOR_EVIDENCE_REF: execution.json#${record.id}`);
      if (references.length > 0) {
        appendFileSync(
          materialized.promptFile,
          `\n\nRetained actor evidence references available for citation:\n${references.join("\n")}\n`,
        );
        materialized.promptBytes = statSync(materialized.promptFile).size;
      }
    }
    activeSubagents += 1;
    const evidenceIndex = evidenceRecords.length;
    const startedEvidence = commandEvidenceStartRecord({
      commandDetail,
      commandId,
      materialized,
      options,
      sessionDir: session.sessionDir,
      stage,
      occurrence,
    });
    evidenceRecords.push(startedEvidence);
    writeExecutionManifest("running");
    event("command.start", {
      activeSubagents,
      command_id: commandId,
      command: commandDetail,
      ...(materialized.promptFile ? { prompt_file: materialized.promptFile } : {}),
      ...(materialized.promptBytes ? { prompt_bytes: materialized.promptBytes } : {}),
      ...(session.sessionDir ? { session_dir: relative(stateDir, session.sessionDir).replaceAll("\\", "/") } : {}),
    });
    progressRunning();
    const captureDir = join(stateDir, "captures", commandId);
    const rawResult = await execCommandTemplate(command, execArgs, {
      ...options,
      captureDir,
    });
    let result = await applyOutputAcceptancePolicy(
      rawResult,
      options?.evidenceContext?.acceptOutput,
    );
    result = {
      ...result,
      evidenceRef: `execution.json#${commandId}`,
    };
    const preflightDiagnostic = result.code !== 0
      ? buildReviewPreflightDiagnostic({
          args: execArgs,
          code: result.code,
          killed: result.killed,
          ...(materialized.promptFile ? { promptFile: materialized.promptFile } : {}),
          promptText: readPromptText(materialized.promptFile),
          stderr: result.stderr,
          stdout: result.stdout,
        })
      : undefined;
    if (preflightDiagnostic) {
      result = {
        ...result,
        stderr: [
          result.stderr,
          formatReviewPreflightDiagnostic(preflightDiagnostic),
        ].filter(Boolean).join("\n"),
      };
    }
    evidenceRecords[evidenceIndex] = commandEvidenceRecord({
      captureDir,
      commandDetail,
      commandId,
      materialized,
      options,
      result,
      rawExitCode: rawResult.code,
      sessionDir: session.sessionDir,
      stage,
      occurrence,
      startedAt: startedEvidence.started_at,
    });
    writeExecutionManifest("running");
    activeSubagents = Math.max(0, activeSubagents - 1);
    completedSubagents += 1;
    if (result.code !== 0) {
      subagentFailures.push({
        code: result.code,
        command: commandDetail,
        killed: result.killed,
        ...captureDetails(result),
        ...(materialized.promptFile ? { prompt_file: materialized.promptFile } : {}),
        ...(preflightDiagnostic ? { preflight: preflightDiagnostic } : {}),
      });
    }
    observation(
      "command.done",
      `Command ${summarizeCommandDetail(commandDetail)} completed with code ${result.code}`,
      {
        activeSubagents,
        ...(meta.artifacts ? { artifacts: meta.artifacts } : {}),
        run_files: [stdoutPath, stderrPath, resultPath, tracePath, executionPath],
        command_id: commandId,
        code: result.code,
        command: commandDetail,
        killed: result.killed,
        ...captureDetails(result),
        ...(materialized.promptFile ? { prompt_file: materialized.promptFile } : {}),
        ...(materialized.promptBytes ? { prompt_bytes: materialized.promptBytes } : {}),
        ...(session.sessionDir ? { session_dir: relative(stateDir, session.sessionDir).replaceAll("\\", "/") } : {}),
        ...(commandSessionFiles(session.sessionDir).length > 0
          ? { session_files: commandSessionFiles(session.sessionDir) }
          : {}),
        ...(preflightDiagnostic ? { preflight: preflightDiagnostic } : {}),
      },
      "log",
      result.code === 0 ? "info" : "error",
    );
    progressRunning();
    return result;
  }
  try {
    event("run.runner.start", { pid: process.pid });
    progressRunning();
    const result = await executeRegisteredTool(
      {
        name: "run_actor",
        description: "Detached command-template run actor",
        template: meta.template,
        args: [],
        defaults: {},
      },
      meta.values || {},
      observedExec,
      meta.cwd,
    );
    const text = result.content?.[0]?.text || "";
    appendFileSync(stdoutPath, text);
    reportEvidence = auditReviewReport(text);
    if (
      reportEvidence?.claims_complete &&
      reportEvidence.complete_allowed !== true
    ) {
      const error = new Error(
        `review report evidence incomplete: missing ${reportEvidence.missing.join(", ")}`,
      );
      error.details = {
        code: 65,
        failureReason: "incomplete review report evidence",
      };
      throw error;
    }
    writeExecutionManifest("done");
    progress("done", {
      completed: 1,
      failures: result.details.nonCriticalFailures || [],
    });
    writeJsonAtomic(resultPath, {
      code: result.details.code,
      command: result.details.command,
      killed: result.details.killed,
      ...(meta.model_policy ? { model_policy: meta.model_policy } : {}),
      truncated: result.details.truncated,
      completedAt: new Date().toISOString(),
    });
    event("run.done", { code: result.details.code });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const details = error && typeof error === "object" ? error.details : undefined;
    appendFileSync(stderrPath, `${message}\n`);
    writeExecutionManifest("failed");
    progress("failed", {
      completed: 0,
      failures: Array.isArray(details?.branches) && details.branches.length > 0
        ? details.branches
        : subagentFailures.length > 0
          ? subagentFailures
          : [{ message }],
      ...(details?.failureReason ? { failureReason: details.failureReason } : {}),
    });
    writeJsonAtomic(resultPath, {
      code: typeof details?.code === "number" ? details.code : 1,
      error: message,
      killed: Boolean(details?.killed),
      ...(Array.isArray(details?.branches) ? { branches: details.branches } : {}),
      ...(details?.failureReason ? { failure_reason: details.failureReason } : {}),
      ...(meta.model_policy ? { model_policy: meta.model_policy } : {}),
      ...(details?.softQuorum ? { soft_quorum: details.softQuorum } : {}),
      completedAt: new Date().toISOString(),
    });
    event("run.failed", {
      error: message,
      ...(details?.failureReason ? { failure_reason: details.failureReason } : {}),
    });
    throw error;
  }
}

try {
  await runAsyncRunner(process.argv[2]);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
