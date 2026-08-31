/**
 * Async run primitive regression tests
 * Covers detached state files, status/list/tail, and cancellation stale-state behavior
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const controlRaceWorker = fileURLToPath(
  new URL("./fixtures/run-control-race-worker.ts", import.meta.url),
);

import {
  archiveRun,
  cancelRun,
  getRunProcessSignalPlan,
  getRunStatus,
  killRun,
  listRuns,
  pruneRun,
  readRunStateIndex,
  rebuildRunStateIndex,
  startRun,
  tailRun,
  teardownRunsOwnedByParent,
} from "../lib/async-runs.ts";
import {
  createRunUiObservationState,
  executeRunRetirements,
  reconcileRunTerminalNotifications,
  summarizeRuns,
} from "../lib/observability.ts";
import * as Limits from "../lib/limits.ts";
import { appendRunControlInStateDir } from "../lib/runs-controls.ts";
import { appendRunTraceEvent, summarizeRunTraceJournal, readRunTraceJournal } from "../lib/runs-trace.ts";
import { appendRunRetentionEvidence, pruneTerminalRun } from "../lib/runs-retention.ts";
import { createActiveSkillRecipeContext } from "../lib/recipes-references.ts";

async function waitForResult(
  stateDir: string,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < 40; i++) {
    const status = getRunStatus(stateDir);
    if (status.result) return status.result as Record<string, unknown>;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("run did not finish");
}

async function waitForFile(path: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      await readFile(path, "utf8");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`file did not appear: ${path}`);
}

async function waitForFileContent(
  path: string,
  pattern: RegExp,
  minBytes = 0,
): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const content = await readFile(path, "utf8");
      if (pattern.test(content) && Buffer.byteLength(content) >= minBytes) return;
    } catch {
      // File is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`file content did not appear: ${path}`);
}

async function waitForJsonStatus(
  path: string,
  status: string,
): Promise<Record<string, any>> {
  for (let i = 0; i < 40; i++) {
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      if (value.status === status) return value;
    } catch {
      // File is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`json status did not appear: ${path} -> ${status}`);
}

async function waitForJsonField(
  path: string,
  field: string,
  expected: unknown,
): Promise<Record<string, any>> {
  let observed: unknown;
  for (let i = 0; i < 200; i++) {
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      observed = value[field];
      if (observed === expected) return value;
    } catch {
      // File is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `json field did not appear: ${path} -> ${field}=${String(expected)} (observed ${String(observed)})`,
  );
}

async function waitForStatus(
  stateDir: string,
  expected: string,
  attempts = 40,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < attempts; i++) {
    const status = getRunStatus(stateDir);
    if (status.status === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`run did not reach status: ${expected}`);
}

async function waitForRunProcessExit(stateDir: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const pid = Number(getRunStatus(stateDir).pid || 0);
    if (!pid) return;
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("Async runs reject reuse of an active run state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-active-"));
  const stateDir = join(root, "active");
  try {
    startRun(
      {
        run_id: "active",
        state_dir: stateDir,
        template: `${process.execPath} -e "setTimeout(() => {}, 10000)"`,
      },
      process.cwd(),
    );
    await waitForStatus(stateDir, "running");
    assert.throws(
      () =>
        startRun(
          {
            run_id: "active",
            state_dir: stateDir,
            template: `${process.execPath} -e "console.log('replacement')"`,
          },
          process.cwd(),
        ),
      /active owned process/,
    );
    cancelRun(stateDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Singleton Skill Recipes reuse one compatible active Run and reject conflicting identity or values", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-singleton-"));
  const skillDir = join(root, "music-player");
  const recipeDir = join(skillDir, "recipes");
  const recipe = join(recipeDir, "playback.json");
  const alternateRecipe = join(recipeDir, "alternate.json");
  const stateDir = join(root, "state");
  await mkdir(recipeDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: music-player\ndescription: Test singleton.\n---\n",
  );
  await writeFile(
    recipe,
    JSON.stringify({
      async: true,
      singleton: true,
      args: ["source:string"],
      defaults: { source: "music" },
      control: ["stop"],
      template: `${process.execPath} -e "setTimeout(() => {}, 10000)"`,
    }),
  );
  await writeFile(
    alternateRecipe,
    JSON.stringify({
      async: true,
      singleton: true,
      args: ["source:string"],
      defaults: { source: "music" },
      control: ["stop"],
      template: `${process.execPath} -e "setTimeout(() => {}, 20000)"`,
    }),
  );
  try {
    const first = startRun(
      { file: recipe, state_dir: stateDir, ownerId: "session-a" },
      process.cwd(),
    );
    await waitForStatus(stateDir, "running");
    assert.equal(first.run, "music-player");
    assert.equal(first.singleton, true);
    const reused = startRun(
      { file: recipe, state_dir: stateDir, ownerId: "session-a" },
      process.cwd(),
    );
    assert.equal(reused.reused, true);
    assert.equal(reused.pid, first.pid);
    assert.equal(reused.run_instance_id, first.run_instance_id);
    assert.throws(
      () =>
        startRun(
          {
            file: recipe,
            state_dir: stateDir,
            ownerId: "session-a",
            values: { source: "other" },
          },
          process.cwd(),
        ),
      /incompatible Recipe identity, owner, startup values, or Control contract/,
    );
    assert.throws(
      () =>
        startRun(
          { file: alternateRecipe, state_dir: stateDir, ownerId: "session-a" },
          process.cwd(),
        ),
      /incompatible Recipe identity, owner, startup values, or Control contract/,
    );
    assert.throws(
      () =>
        startRun(
          { file: recipe, run_id: "other", state_dir: join(root, "other") },
          process.cwd(),
        ),
      /singleton Recipe run identity is run:music-player/,
    );
    await writeFile(join(stateDir, "workload-state.json"), "retained\n");
    cancelRun(stateDir);
    await waitForRunProcessExit(stateDir);
    const restarted = startRun(
      { file: recipe, state_dir: stateDir, ownerId: "session-a" },
      process.cwd(),
    );
    assert.equal(restarted.run, "music-player");
    assert.notEqual(restarted.run_instance_id, first.run_instance_id);
    assert.equal(await readFile(join(stateDir, "workload-state.json"), "utf8"), "retained\n");
    cancelRun(stateDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Singleton reuse rejects a terminal result while its runner process exits", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-singleton-terminal-"));
  const skillDir = join(root, "service");
  const recipeDir = join(skillDir, "recipes");
  const recipe = join(recipeDir, "worker.json");
  const stateDir = join(root, "state");
  await mkdir(recipeDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: service\ndescription: Test singleton terminal boundary.\n---\n",
  );
  await writeFile(
    recipe,
    JSON.stringify({
      async: true,
      singleton: true,
      template: `${process.execPath} -e "setTimeout(() => {}, 10000)"`,
    }),
  );
  try {
    const first = startRun(
      { file: recipe, state_dir: stateDir, ownerId: "session-a" },
      process.cwd(),
    );
    await waitForStatus(stateDir, "running");
    await writeFile(
      join(stateDir, "result.json"),
      JSON.stringify({ code: 0, completedAt: new Date().toISOString() }),
    );
    assert.throws(
      () =>
        startRun(
          { file: recipe, state_dir: stateDir, ownerId: "session-a" },
          process.cwd(),
        ),
      /active owned process/,
    );
    process.kill(first.pid, "SIGKILL");
    await waitForRunProcessExit(stateDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async run controls fail closed on persisted process identity mismatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-process-identity-"));
  const stateDir = join(root, "identity");
  let runPid: number | undefined;
  try {
    const meta = startRun(
      {
        run_id: "identity",
        state_dir: stateDir,
        template: `${process.execPath} -e "setTimeout(() => {}, 30000)"`,
      },
      process.cwd(),
    );
    runPid = meta.pid;
    assert.equal(typeof meta.process_identity?.start_time, "string");
    const runPath = join(stateDir, "run.json");
    const stored = JSON.parse(await readFile(runPath, "utf8"));
    await writeFile(
      runPath,
      JSON.stringify({
        ...stored,
        process_identity: {
          ...stored.process_identity,
          start_time: `${stored.process_identity.start_time}-reused`,
        },
      }),
    );
    assert.throws(
      () =>
        startRun(
          {
            run_id: "identity",
            state_dir: stateDir,
            template: `${process.execPath} -e "setTimeout(() => {}, 30000)"`,
          },
          process.cwd(),
        ),
      /identity does not match the live pid/,
    );
    assert.doesNotThrow(() => process.kill(meta.pid, 0));
    const status = getRunStatus(stateDir);
    assert.equal(status.process_identity_status, "owner_mismatch");
    const cancelled = cancelRun(stateDir);
    assert.equal(cancelled.cancelled, false);
    assert.equal(cancelled.process_identity_status, "owner_mismatch");
    assert.doesNotThrow(() => process.kill(meta.pid, 0));
    await writeFile(runPath, JSON.stringify(stored));
    try {
      killRun(stateDir);
    } catch (error) {
      if (process.platform !== "win32" || !/unsupported proof/.test(String(error))) throw error;
    }
  } finally {
    if (runPid !== undefined) {
      try {
        process.kill(runPid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "Async runs capture process identity from a symlinked launch cwd",
  { skip: process.platform !== "linux" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-symlink-cwd-"));
    const realCwd = join(root, "real-cwd");
    const aliasCwd = join(root, "alias-cwd");
    const stateDir = join(root, "state");
    try {
      await mkdir(realCwd);
      await symlink(realCwd, aliasCwd, "dir");
      const meta = startRun(
        {
          run_id: "symlink-cwd",
          state_dir: stateDir,
          template: `${process.execPath} -e "setTimeout(() => {}, 3000)"`,
        },
        aliasCwd,
      );
      assert.equal(meta.process_identity?.cwd, await realpath(realCwd));
      assert.equal(getRunStatus(stateDir).process_identity_status, "valid");
      killRun(stateDir);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("Async runs write state files and finish", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-"));
  const stateDir = join(root, "hello");
  try {
    const meta = startRun(
      {
        run_id: "hello",
        state_dir: stateDir,
        template: `${process.execPath} -e "console.log('hello ' + process.argv[1])" {name}`,
        values: { name: "world" },
      },
      process.cwd(),
    );
    assert.equal(meta.run, "hello");
    assert.equal(meta.state_schema, "run-kernel-v1");
    assert.equal(meta.ownerId, undefined);
    assert.equal(meta.values.actor_address, undefined);
    assert.equal(meta.values.communication_file, undefined);
    assert.equal(meta.values.default_room, undefined);
    assert.equal(meta.values.trace_file, join(stateDir, "trace.jsonl"));
    const result = await waitForResult(stateDir);
    assert.equal(result.code, 0);
    const status = getRunStatus(stateDir);
    assert.equal(status.status, "done");
    assert.equal((listRuns(root)[0] || {}).run, "hello");
    assert.match(
      await readFile(join(stateDir, "trace.jsonl"), "utf8"),
      /"kind":"run\.(start|runner\.start|done)"/,
    );
    assert.match(
      await readFile(join(stateDir, "stdout.log"), "utf8"),
      /hello world/,
    );
    const evidence = JSON.parse(
      await readFile(join(stateDir, "execution.json"), "utf8"),
    );
    assert.equal(evidence.version, 1);
    assert.equal(evidence.run, "hello");
    assert.equal(evidence.status, "done");
    assert.equal(evidence.commands.length, 1);
    assert.equal(evidence.commands[0].id, "command-001");
    assert.equal(evidence.commands[0].semantic_acceptance, "not_required");
    assert.deepEqual(evidence.commands[0].attempts, [
      {
        attempt: 1,
        stdout: {
          path: "captures/command-001/attempt-001/stdout.log",
          bytes: 12,
        },
        stderr: {
          path: "captures/command-001/attempt-001/stderr.log",
          bytes: 0,
        },
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async review evidence rejects marker prefixes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-review-marker-"));
  const stateDir = join(root, "review-marker");
  try {
    startRun(
      {
        run_id: "review-marker",
        state_dir: stateDir,
        template: {
          accept_output: "review_evidence",
          template: `${process.execPath} -e "console.log('ACTOR_REVIEW_RESULT_BOGUS')"`,
        },
      },
      process.cwd(),
    );
    const result = await waitForResult(stateDir);
    const evidence = await waitForJsonStatus(
      join(stateDir, "execution.json"),
      "failed",
    );
    assert.equal(result.code, 65);
    assert.equal(evidence.status, "failed");
    assert.equal(evidence.commands[0].effective_exit_code, 65);
    assert.equal(evidence.commands[0].semantic_acceptance, "rejected");
    const trace = (await readFile(join(stateDir, "trace.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const commandDone = trace.find(
      (event) => event.kind === "command.done" && event.data?.code === 65,
    );
    assert.equal(commandDone.data.code, 65);
    assert.equal(commandDone.attention, undefined);
    assert.equal(commandDone.level, "error");
    assert.match(commandDone.summary, /code 65/);
    const progress = await waitForJsonField(
      join(stateDir, "progress.json"),
      "phase",
      "failed",
    );
    assert.equal(progress.phase, "failed");
    assert.equal(progress.failures[0].code, 65);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async review evidence accepts a large marker from complete capture", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-large-review-marker-"));
  const stateDir = join(root, "large-review-marker");
  try {
    startRun(
      {
        run_id: "large-review-marker",
        state_dir: stateDir,
        template: {
          accept_output: "review_evidence",
          template: `${process.execPath} -e "process.stdout.write(['ACTOR_REVIEW_RESULT','X'.repeat(1100000)].join(String.fromCharCode(10)))"`,
        },
      },
      process.cwd(),
    );
    const result = await waitForResult(stateDir);
    const evidence = await waitForJsonStatus(
      join(stateDir, "execution.json"),
      "done",
    );
    assert.equal(result.code, 0);
    assert.equal(evidence.status, "done");
    assert.equal(evidence.commands[0].semantic_acceptance, "accepted");
    assert.equal(evidence.commands[0].stdout_truncated, true);
    assert.equal(evidence.commands[0].stdout_bytes, 1_100_020);
  } finally {
    try {
      await waitForRunProcessExit(stateDir);
    } catch {
      // Best-effort synchronization before recursive cleanup.
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("Async review reports fail closed when complete evidence references are missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-review-evidence-"));
  const stateDir = join(root, "review-evidence");
  try {
    startRun(
      {
        run_id: "review-evidence",
        state_dir: stateDir,
        template: [
          {
            actorRecipeContext: { alias: "reviewer", name: "reviewer" },
            accept_output: "review_evidence",
            template: `${process.execPath} -e "console.log(['ACTOR_REVIEW_RESULT','review'].join(String.fromCharCode(10)))"`,
          },
          {
            actorRecipeContext: { alias: "normalizer", name: "normalizer" },
            accept_output: "review_evidence",
            template: `${process.execPath} -e "console.log(['ACTOR_REVIEW_RESULT','## Status','complete'].join(String.fromCharCode(10)))"`,
          },
        ],
      },
      process.cwd(),
    );
    const result = await waitForResult(stateDir);
    const evidence = JSON.parse(
      await readFile(join(stateDir, "execution.json"), "utf8"),
    );
    assert.equal(result.code, 65, JSON.stringify(evidence));
    assert.equal(result.failure_reason, "incomplete review report evidence");
    assert.equal(evidence.status, "failed");
    assert.equal(evidence.report_evidence.claims_complete, true);
    assert.equal(evidence.report_evidence.complete_allowed, false);
    assert.deepEqual(evidence.report_evidence.missing, [
      "execution.json#command-001",
    ]);
    const trace = (await readFile(join(stateDir, "trace.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const commandDone = trace.filter((event) => event.kind === "command.done");
    assert.equal(commandDone.length, 2);
    assert.equal(
      commandDone.every((event) => event.attention === undefined),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async runs persist bounded high-volume command captures", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-capture-"));
  const stateDir = join(root, "capture");
  try {
    startRun(
      {
        run_id: "capture",
        state_dir: stateDir,
        template: `${process.execPath} -e "process.stdout.write('A'.repeat(1100000)); process.stderr.write('B'.repeat(1100000))"`,
      },
      process.cwd(),
    );
    const result = await waitForResult(stateDir);
    assert.equal(result.code, 0);
    const trace = await readFile(join(stateDir, "trace.jsonl"), "utf8");
    assert.match(trace, /"stdout_bytes":1100000/);
    assert.match(trace, /"stderr_bytes":1100000/);
    assert.match(trace, /"stdout_truncated":true/);
    assert.match(trace, /"stderr_truncated":true/);
    assert.equal(
      (await readFile(join(stateDir, "captures", "command-001", "attempt-001", "stdout.log"), "utf8")).length,
      1100000,
    );
    assert.equal(
      (await readFile(join(stateDir, "captures", "command-001", "attempt-001", "stderr.log"), "utf8")).length,
      1100000,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async lifecycle status files preserve terminal semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-lifecycle-"));
  const exitedDir = join(root, "exited-before-result");
  const cancelledDir = join(root, "cancelled-before-result");
  const killedDir = join(root, "killed-before-result");
  try {
    await mkdir(exitedDir, { recursive: true });
    await writeFile(
      join(exitedDir, "run.json"),
      JSON.stringify({ pid: 0, run: "exited-before-result", state_dir: exitedDir }),
    );
    await writeFile(join(exitedDir, "trace.jsonl"), `${JSON.stringify({ kind: "run.start" })}\n`);
    assert.equal(getRunStatus(exitedDir).status, "exited");
    assert.match(tailRun(exitedDir), /run\.start/);
    await mkdir(cancelledDir, { recursive: true });
    await writeFile(
      join(cancelledDir, "run.json"),
      JSON.stringify({ pid: 0, run: "cancelled-before-result", state_dir: cancelledDir }),
    );
    await writeFile(join(cancelledDir, "trace.jsonl"), `${JSON.stringify({ kind: "run.cancel" })}\n`);
    assert.equal(getRunStatus(cancelledDir).status, "cancelled");
    await mkdir(killedDir, { recursive: true });
    await writeFile(
      join(killedDir, "run.json"),
      JSON.stringify({ pid: 0, run: "killed-before-result", state_dir: killedDir }),
    );
    await writeFile(join(killedDir, "trace.jsonl"), `${JSON.stringify({ kind: "run.kill" })}\n`);
    assert.equal(getRunStatus(killedDir).status, "killed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async runs emit command completion Trace events", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-"));
  const stateDir = join(root, "command-trace");
  const longArg = "x".repeat(220);
  try {
    startRun(
      {
        run_id: "command-trace",
        state_dir: stateDir,
        defaults: { report_path: "{state_dir}/report.md" },
        artifacts: {
          report: "{report_path}",
          summary: "{state_dir}/result.json",
        },
        template: `${process.execPath} -e "console.log('artifact')" ${longArg}`,
      },
      process.cwd(),
    );
    await waitForResult(stateDir);
    const trace = (await readFile(join(stateDir, "trace.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const commandDone = trace.find(
      (entry) => entry.kind === "command.done" && typeof entry.summary === "string",
    )!;
    const status = getRunStatus(stateDir);
    assert.deepEqual(status.artifacts, {
      report: `${stateDir}/report.md`,
      summary: `${stateDir}/result.json`,
    });
    assert.equal(commandDone.kind, "command.done");
    assert.equal(Object.hasOwn(commandDone, "type"), false);
    assert.equal(Object.hasOwn(commandDone, "to"), false);
    assert.equal(Object.hasOwn(commandDone, "from"), false);
    assert.equal(commandDone.attention, undefined);
    assert.match(String(commandDone.summary), /completed with code 0/);
    assert.equal(String(commandDone.summary).includes(longArg), false);
    assert.match(
      String((commandDone.data as Record<string, unknown>).command),
      new RegExp(longArg),
    );
    assert.deepEqual(
      (commandDone.data as Record<string, unknown>).artifacts,
      {
        report: `${stateDir}/report.md`,
        summary: `${stateDir}/result.json`,
      },
    );
    assert.equal(Object.hasOwn(commandDone, "body"), false);
    assert.deepEqual(
      (commandDone.data as Record<string, unknown>).run_files,
      [
        join(stateDir, "stdout.log"),
        join(stateDir, "stderr.log"),
        join(stateDir, "result.json"),
        join(stateDir, "trace.jsonl"),
        join(stateDir, "execution.json"),
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async runs expose failed terminal status", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-"));
  const stateDir = join(root, "failed");
  try {
    startRun(
      {
        run_id: "failed",
        state_dir: stateDir,
        template: `${process.execPath} -e "process.exit(7)"`,
      },
      process.cwd(),
    );
    const result = await waitForResult(stateDir);
    assert.equal(result.code, 7);
    assert.equal(getRunStatus(stateDir).status, "failed");
    assert.equal((listRuns(root)[0] || {}).status, "failed");
    assert.equal(listRuns(root, "running").length, 0);
    assert.equal(listRuns(root, "terminal").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async run restart clears all prior bounded evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-"));
  const stateDir = join(root, "restart");
  try {
    startRun(
      {
        run_id: "restart",
        state_dir: stateDir,
        template: `${process.execPath} -e "console.log('first')"`,
      },
      process.cwd(),
    );
    await waitForResult(stateDir);
    assert.equal(getRunStatus(stateDir).status, "done");
    await waitForRunProcessExit(stateDir);
    for (let index = 0; index < Limits.TRACE_JOURNAL_MAX_EVENTS + 1; index += 1)
      appendRunTraceEvent(stateDir, { kind: "restart.pressure", data: { index } });
    for (let index = 0; index < Limits.RUN_CONTROL_PENDING_LIMIT; index += 1)
      appendRunControlInStateDir(stateDir, {
        action: "pause", input: { index }, run_instance_id: String(getRunStatus(stateDir).run_instance_id),
      });
    await writeFile(join(stateDir, "control-endpoint.json"), "{}\n");
    assert.equal(summarizeRunTraceJournal(readRunTraceJournal(stateDir)).compacted, true);
    startRun(
      {
        run_id: "restart",
        state_dir: stateDir,
        template: `${process.execPath} -e "setTimeout(() => {}, 1000)"`,
      },
      process.cwd(),
    );
    const status = getRunStatus(stateDir);
    assert.equal(status.status, "running");
    assert.equal(status.result, null);
    assert.equal(existsSync(join(stateDir, "controls.jsonl")), false);
    assert.equal(existsSync(join(stateDir, "control-endpoint.json")), false);
    const trace = readRunTraceJournal(stateDir);
    const kinds = trace.events.map(({ event }) => event.kind);
    assert.equal(kinds.includes("run.start"), true);
    assert.equal(kinds.includes("restart.pressure"), false);
    assert.equal(summarizeRunTraceJournal(trace).compacted, false);
  } finally {
    try {
      cancelRun(stateDir);
    } catch {}
    await waitForRunProcessExit(stateDir);
    await rm(root, { recursive: true, force: true });
  }
});

test("Async runs persist coordinator owner ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-"));
  const stateDir = join(root, "owned");
  try {
    const meta = startRun(
      {
        run_id: "owned",
        ownerId: "session-a",
        state_dir: stateDir,
        template: `${process.execPath} -e "console.log('owned')"`,
      },
      process.cwd(),
    );
    assert.equal(meta.ownerId, "session-a");
    await waitForResult(stateDir);
    assert.equal(getRunStatus(stateDir).ownerId, "session-a");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async runs can start from recipe files with overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-"));
  const stateDir = join(root, "file-run");
  const file = join(root, "say.json");
  try {
    await writeFile(
      file,
      JSON.stringify(
        {
          control: ["continue"],
          retire_when: "children_terminal",
          template: `${process.execPath} -e "console.log(process.argv[1] + ' ' + process.argv[2])" {greeting} {name}`,
          values: { greeting: "hello", name: "file" },
        },
        null,
        2,
      ),
    );
    const meta = startRun(
      { file: "./say.json", run_id: "override-run", state_dir: stateDir, values: { name: "override" } },
      root,
    );
    assert.equal(meta.run, "override-run");
    assert.equal(meta.recipe, "say");
    assert.equal(meta.values.greeting, "hello");
    assert.deepEqual(meta.control, ["continue"]);
    assert.equal(meta.retire_when, "children_terminal");
    assert.equal(meta.values.name, "override");
    assert.equal(meta.values.run_id, "override-run");
    assert.equal(meta.values.state_dir, stateDir);
    const result = await waitForResult(stateDir);
    assert.equal(result.code, 0);
    assert.match(
      await readFile(join(stateDir, "stdout.log"), "utf8"),
      /hello override/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async file Recipes expand runtime-owned recipe directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-origin-"));
  const skillDir = join(root, "skill");
  const recipeDir = join(skillDir, "recipes");
  const stateDir = join(root, "run");
  try {
    await mkdir(recipeDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Skill\n");
    const file = join(recipeDir, "origin.json");
    await writeFile(
      file,
      JSON.stringify({
        artifacts: { report: "{recipe_dir}/report.md" },
        defaults: { helper: "{skill_dir}/scripts/helper.mjs" },
        template: `${process.execPath} -e "console.log(process.argv[1] + '|' + process.argv[2] + '|' + process.argv[3])" {recipe_dir} {skill_dir} {helper}`,
      }),
    );
    const meta = startRun(
      {
        file,
        run_id: "origin",
        state_dir: stateDir,
        values: { recipe_dir: "/caller", skill_dir: "/caller-skill" },
      },
      process.cwd(),
    );
    assert.equal(meta.values.recipe_dir, recipeDir);
    assert.equal(meta.values.skill_dir, skillDir);
    assert.deepEqual(meta.artifacts, { report: `${recipeDir}/report.md` });
    await waitForResult(stateDir);
    assert.equal(
      (await readFile(join(stateDir, "stdout.log"), "utf8")).trim(),
      `${recipeDir}|${skillDir}|${skillDir}/scripts/helper.mjs`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async Recipe values follow caller then values then defaults then inline precedence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-precedence-"));
  const file = join(root, "mode.json");
  try {
    await writeFile(
      file,
      JSON.stringify({
        args: ["mode:enum(inline,default,bound,caller)=inline"],
        defaults: { mode: "default" },
        values: { mode: "bound" },
        template: `${process.execPath} -e "console.log(process.argv[1])" {mode}`,
      }),
    );
    const boundState = join(root, "bound");
    const bound = startRun(
      { file, run_id: "bound", state_dir: boundState },
      process.cwd(),
    );
    assert.equal(bound.values.mode, "bound");
    await waitForResult(boundState);
    const callerState = join(root, "caller");
    const caller = startRun(
      {
        file,
        run_id: "caller",
        state_dir: callerState,
        values: { mode: "caller" },
      },
      process.cwd(),
    );
    assert.equal(caller.values.mode, "caller");
    await waitForResult(callerState);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async Recipes reject invalid typed values and unknown defaults before launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-contract-"));
  try {
    const invalidEnum = join(root, "invalid-enum.json");
    await writeFile(
      invalidEnum,
      JSON.stringify({
        args: ["mode:enum(check,fix)=check"],
        values: { mode: "delete" },
        template: "echo {mode}",
      }),
    );
    assert.throws(
      () => startRun({ file: invalidEnum, run_id: "invalid" }, process.cwd()),
      /Argument mode must be one of: check, fix/,
    );
    const unknownDefault = join(root, "unknown-default.json");
    await writeFile(
      unknownDefault,
      JSON.stringify({
        args: ["mode:enum(check,fix)"],
        defaults: { typo: "check" },
        template: "echo {mode}",
      }),
    );
    assert.throws(
      () => startRun({ file: unknownDefault, run_id: "unknown" }, process.cwd()),
      /Unknown Recipe default argument: typo/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async runs reject disabled recipe files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-disabled-"));
  const file = join(root, "disabled.json");
  try {
    await writeFile(
      file,
      JSON.stringify({ disabled: true, template: "echo disabled" }, null, 2),
    );
    assert.throws(
      () => startRun({ file, run_id: "disabled-run" }, process.cwd()),
      /Template recipe is disabled:/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async runs can start from Markdown recipe files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-md-"));
  const stateDir = join(root, "md-run");
  const file = join(root, "say-md.md");
  try {
    await writeFile(
      file,
      [
        "---",
        "defaults:",
        "  greeting: hello",
        "---",
        "",
        "```template",
        `${process.execPath} -e "console.log(process.argv[1])" {greeting}`,
        "```",
        "",
      ].join("\n"),
    );
    const meta = startRun({ file, state_dir: stateDir }, process.cwd());
    assert.equal(meta.recipe, "say-md");
    const result = await waitForResult(stateDir);
    assert.equal(result.code, 0);
    assert.match(await readFile(join(stateDir, "stdout.log"), "utf8"), /hello/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async runs persist recipe context bundles for file-backed recipes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-context-"));
  const stateDir = join(root, "context-run");
  const child = join(root, "child.json");
  const parent = join(root, "parent.json");
  try {
    await writeFile(
      child,
      JSON.stringify({ template: `${process.execPath} -e "console.log('child')"` }),
    );
    await writeFile(
      parent,
      JSON.stringify({
        imports: { child_step: "child.json" },
        template: [{ name: "child_step" }],
      }),
    );
    const meta = startRun({ file: parent, state_dir: stateDir }, process.cwd());
    assert.equal(meta.recipe_context_records?.length, 2);
    assert.deepEqual(
      meta.recipe_context_records?.map((record) => ({
        alias: record.alias,
        importPath: record.import_path,
        logicalReference: record.logical_reference,
        name: record.name,
        role: record.role,
        sourceKind: record.source_kind,
      })),
      [
        {
          alias: undefined,
          importPath: [],
          logicalReference: "parent.json",
          name: "parent",
          role: "entry",
          sourceKind: "explicit_file_recipe",
        },
        {
          alias: "child_step",
          importPath: ["child_step"],
          logicalReference: "child.json",
          name: "child",
          role: "import",
          sourceKind: "explicit_file_recipe",
        },
      ],
    );
    assert.match(JSON.stringify(meta.template), /actorRecipeContext/);
    const result = await waitForResult(stateDir);
    assert.equal(result.code, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async Skill Recipes capture logical provenance and private physical source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-skill-context-"));
  const skillDir = join(root, "sample");
  const recipeDir = join(skillDir, "recipes");
  const stateDir = join(root, "skill-run");
  try {
    await mkdir(recipeDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Sample\n");
    await writeFile(join(recipeDir, "task.json"), JSON.stringify({ template: "echo ok" }));
    const skillContext = createActiveSkillRecipeContext([
      { name: "sample", baseDir: skillDir },
    ]);
    const meta = startRun(
      { file: "sample/task", state_dir: stateDir },
      process.cwd(),
      { skillContext },
    );
    assert.deepEqual(meta.recipe_context_records?.map((record) => ({
      logicalReference: record.logical_reference,
      role: record.role,
      skill: record.skill,
      sourceFile: record.source_file,
      sourceKind: record.source_kind,
    })), [{
      logicalReference: "sample/task",
      role: "entry",
      skill: "sample",
      sourceFile: join(recipeDir, "task.json"),
      sourceKind: "active_skill_component",
    }]);
    await waitForResult(stateDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async Pi commands persist owned session provenance in review evidence", {
  skip: process.platform === "win32" ? "uses a POSIX shebang fake pi executable" : false,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-session-"));
  const stateDir = join(root, "session-run");
  const fakePi = join(root, "pi");
  try {
    await writeFile(
      fakePi,
      [
        "#!/usr/bin/env node",
        'const { mkdirSync, writeFileSync } = require("node:fs");',
        'const { join } = require("node:path");',
        'const index = process.argv.indexOf("--session-dir");',
        'if (index >= 0) {',
        '  const dir = process.argv[index + 1];',
        '  mkdirSync(dir, { recursive: true });',
        '  writeFileSync(join(dir, "session.jsonl"), JSON.stringify({ type: "session", version: 3, id: "test", cwd: process.cwd() }) + "\\n");',
        '}',
        'console.log("done");',
      ].join("\n"),
    );
    await chmod(fakePi, 0o755);
    startRun(
      { state_dir: stateDir, template: `${fakePi} -p inspect turns` },
      process.cwd(),
    );
    const result = await waitForResult(stateDir);
    assert.equal(result.code, 0);
    const evidence = JSON.parse(
      await readFile(join(stateDir, "execution.json"), "utf8"),
    );
    assert.equal(evidence.commands[0].session_dir, "sessions/command-001");
    assert.deepEqual(evidence.commands[0].session_files, [
      "sessions/command-001/session.jsonl",
    ]);
    assert.match(evidence.commands[0].command, /--session-dir/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async runs allow recipes to opt out of actor recipe context", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-context-off-"));
  const stateDir = join(root, "context-off-run");
  const file = join(root, "quiet.json");
  try {
    await writeFile(
      file,
      JSON.stringify({
        actor_context: false,
        template: `${process.execPath} -e "console.log('quiet')"`,
      }),
    );
    const meta = startRun({ file, state_dir: stateDir }, process.cwd());
    assert.equal(meta.recipe_context_records, undefined);
    assert.doesNotMatch(JSON.stringify(meta.template), /actorRecipeContext/);
    const result = await waitForResult(stateDir);
    assert.equal(result.code, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Recipe files can put command-template flags at the recipe top level", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-"));
  const stateDir = join(root, "top-level-parallel");
  const file = join(root, "parallel.json");
  try {
    await writeFile(
      file,
      JSON.stringify(
        {
          parallel: true,
          template: [
            `${process.execPath} -e "console.log('left')"`,
            `${process.execPath} -e "console.log('right')"`,
          ],
        },
        null,
        2,
      ),
    );
    const meta = startRun({ file, state_dir: stateDir }, process.cwd());
    assert.equal(meta.run, "parallel");
    assert.equal(typeof meta.template, "object");
    assert.equal(Array.isArray(meta.template), false);
    const result = await waitForResult(stateDir);
    assert.equal(result.code, 0);
    const stdout = await readFile(join(stateDir, "stdout.log"), "utf8");
    assert.match(stdout, /left/);
    assert.match(stdout, /right/);
    const trace = (await readFile(join(stateDir, "trace.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const commandDone = trace.filter((event) => event.kind === "command.done");
    assert.equal(commandDone.length, 2);
    assert.equal(
      commandDone.every((event) => event.attention === undefined),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Parallel branch failure remains Trace-only when the root Run succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-soft-quorum-"));
  const stateDir = join(root, "soft-quorum");
  try {
    startRun(
      {
        ownerId: "session-a",
        run_id: "soft-quorum",
        state_dir: stateDir,
        template: [
          {
            parallel: true,
            template: [
              `${process.execPath} -e "console.log('usable')"`,
              `${process.execPath} -e "process.exit(7)"`,
            ],
          },
          `${process.execPath} -e "process.stdin.pipe(process.stdout)"`,
        ],
      },
      process.cwd(),
    );
    const result = await waitForResult(stateDir);
    assert.equal(result.code, 0);
    const trace = (await readFile(join(stateDir, "trace.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const commandDone = trace.filter((event) => event.kind === "command.done");
    assert.equal(commandDone.length, 3);
    assert.deepEqual(
      commandDone
        .map((event) => Number((event.data as Record<string, unknown>).code))
        .sort(),
      [0, 0, 7],
    );
    assert.equal(
      commandDone.every((event) => event.attention === undefined),
      true,
    );
    const delivered: Array<{ customType: string }> = [];
    const state = createRunUiObservationState();
    const reconcile = () =>
      reconcileRunTerminalNotifications({
        includeAttention: true,
        ownerId: "session-a",
        sink: {
          notify: () => {},
          sendFollowUp: (message) => delivered.push(message),
        },
        state,
        stateRoot: root,
      });
    reconcile();
    reconcile();
    assert.deepEqual(
      delivered.map((message) => message.customType),
      ["pi-actors-run"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Recipe imports execute under repeated parallel parent nodes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-"));
  const stateDir = join(root, "import-repeat");
  const child = join(root, "child.json");
  const parent = join(root, "parent.json");
  try {
    await writeFile(
      child,
      JSON.stringify(
        {
          args: ["word:string"],
          template: `${process.execPath} -e "console.log(process.argv[1])" {word}-{index}-{_index}`,
        },
        null,
        2,
      ),
    );
    await writeFile(
      parent,
      JSON.stringify(
        {
          imports: {
            node: {
              from: "child.json",
              values: { word: "base" },
            },
          },
          repeat: 3,
          parallel: true,
          failure: "branch",
          template: {
            name: "node",
            values: { word: "{index}" },
          },
        },
        null,
        2,
      ),
    );
    const meta = startRun({ file: parent, state_dir: stateDir }, process.cwd());
    assert.equal(meta.run, "parent");
    const result = await waitForResult(stateDir);
    assert.equal(result.code, 0);
    assert.match(String(result.command), /0-0-00/);
    const stdout = await readFile(join(stateDir, "stdout.log"), "utf8");
    assert.match(stdout, /0-0-00/);
    assert.match(stdout, /1-1-01/);
    assert.match(stdout, /2-2-02/);
    const trace = (await readFile(join(stateDir, "trace.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const commandDone = trace.filter((event) => event.kind === "command.done");
    assert.equal(commandDone.length, 3);
    assert.equal(
      commandDone.every((event) => event.attention === undefined),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("Async run process control maps Windows force kill to taskkill tree", () => {
  assert.deepEqual(getRunProcessSignalPlan(1234, "SIGKILL", "win32"), {
    args: ["/PID", "1234", "/T", "/F"],
    command: "taskkill",
    signalTarget: "processTree",
  });
  assert.deepEqual(getRunProcessSignalPlan(1234, "SIGTERM", "win32"), {
    args: ["/PID", "1234", "/T"],
    command: "taskkill",
    signalTarget: "processTree",
  });
});

test("Async run cancel terminates matching running runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-"));
  const stateDir = join(root, "running");
  try {
    startRun(
      {
        run_id: "running",
        state_dir: stateDir,
        template: `${process.execPath} -e "setTimeout(() => {}, 5000)"`,
      },
      process.cwd(),
    );
    for (let i = 0; i < 20; i++) {
      if (getRunStatus(stateDir).status === "running") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const result = cancelRun(stateDir);
    assert.equal(result.cancelled, true);
    const status = await waitForStatus(stateDir, "cancelled");
    assert.equal(status.status, "cancelled");
    const handled = status.terminal_handled as Record<string, unknown>;
    assert.deepEqual(handled, {
      event: "run.cancel",
      signal: "SIGTERM",
      ts: handled.ts,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async cancel and kill finalize in-flight review evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-interrupted-evidence-"));
  try {
    for (const mode of ["cancelled", "killed"] as const) {
      const stateDir = join(root, mode);
      startRun(
        {
          run_id: `review-${mode}`,
          state_dir: stateDir,
          template: {
            accept_output: "review_evidence",
            template: `${process.execPath} -e "process.stdout.write('partial');setInterval(()=>{},1000)"`,
          },
        },
        process.cwd(),
      );
      let runningEvidence: any;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
          runningEvidence = JSON.parse(
            await readFile(join(stateDir, "execution.json"), "utf8"),
          );
          if (runningEvidence.commands?.[0]?.status === "running") break;
        } catch {
          // Runner has not initialized evidence yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(runningEvidence?.commands?.[0]?.status, "running");
      const captureFile = join(
        stateDir,
        "captures/command-001/attempt-001/stdout.log",
      );
      await waitForFileContent(captureFile, /partial/, 7);
      if (mode === "cancelled") cancelRun(stateDir);
      else killRun(stateDir);
      await waitForStatus(stateDir, mode);
      const evidence = JSON.parse(
        await readFile(join(stateDir, "execution.json"), "utf8"),
      );
      assert.equal(evidence.status, mode);
      assert.equal(evidence.commands[0].status, mode);
      assert.equal(evidence.commands[0].killed, true);
      assert.equal(
        evidence.commands[0].effective_exit_code,
        mode === "killed" ? 137 : 143,
      );
      assert.equal(evidence.commands[0].semantic_acceptance, "interrupted");
      assert.equal(evidence.commands[0].attempts.length, 1);
      assert.equal(evidence.commands[0].attempts[0].stdout.bytes, 7);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async run cancel signals the running command process group", {
  skip: process.platform === "win32" ? "Windows cancellation uses taskkill process-tree semantics" : false,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-"));
  const stateDir = join(root, "running-group");
  const pidFile = join(root, "child.pid");
  const termFile = join(root, "child.term");
  let childPid = 0;
  try {
    startRun(
      {
        run_id: "running-group",
        state_dir: stateDir,
        template: `${process.execPath} -e "const fs=require('fs');fs.writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>(fs.writeFileSync(process.argv[2],'term'),process.exit(0)));setTimeout(()=>0,5000)" {pidFile} {termFile}`,
        values: { pidFile, termFile },
      },
      process.cwd(),
    );
    await waitForFile(pidFile);
    childPid = Number(await readFile(pidFile, "utf8"));
    const result = cancelRun(stateDir);
    assert.equal(result.cancelled, true);
    await waitForFile(termFile);
    assert.equal(await readFile(termFile, "utf8"), "term");
  } finally {
    if (childPid > 0) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // Already stopped by process-group cancellation.
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("Async run status keeps killed runs diagnosable with stale progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-killed-stale-progress-"));
  const stateDir = join(root, "stale-progress");
  try {
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      join(stateDir, "run.json"),
      `${JSON.stringify({ created_at: new Date().toISOString(), pid: 0, run: "stale-progress", state_dir: stateDir })}\n`,
    );
    await writeFile(
      join(stateDir, "trace.jsonl"),
      `${JSON.stringify({ kind: "run.kill", data: { signal: "SIGKILL" }, ts: new Date().toISOString() })}\n`,
    );
    await writeFile(
      join(stateDir, "progress.json"),
      `${JSON.stringify({ activeSubagents: 2, phase: "running" })}\n`,
    );
    const status = getRunStatus(stateDir);
    assert.equal(status.status, "killed");
    assert.deepEqual(status.progress, { activeSubagents: 2, phase: "running" });
    assert.match(tailRun(stateDir), /run\.kill/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async run kill terminates matching stuck runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-"));
  const stateDir = join(root, "stuck");
  try {
    startRun(
      {
        run_id: "stuck",
        state_dir: stateDir,
        template: `${process.execPath} -e "setTimeout(() => {}, 5000)"`,
      },
      process.cwd(),
    );
    for (let i = 0; i < 20; i++) {
      if (getRunStatus(stateDir).status === "running") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const result = killRun(stateDir);
    assert.equal(result.killed, true);
    assert.equal(result.signal, "SIGKILL");
    const status = await waitForStatus(stateDir, "killed");
    assert.equal(status.status, "killed");
    const handled = status.terminal_handled as Record<string, unknown>;
    assert.deepEqual(handled, {
      event: "run.kill",
      signal: "SIGKILL",
      ts: handled.ts,
    });
    const progress = status.progress as Record<string, unknown>;
    assert.equal(progress.phase, "killed");
    assert.equal(Object.hasOwn(progress, "activeSubagents"), false);
    assert.match(await readFile(join(stateDir, "trace.jsonl"), "utf8"), /"kind":"run\.kill"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Canonical kill rejects a replacement run generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-generation-fence-"));
  const stateDir = join(root, "replacement");
  try {
    startRun(
      {
        ownerId: "session-a",
        run_id: "replacement",
        state_dir: stateDir,
        template: `${process.execPath} -e "setTimeout(() => {}, 5000)"`,
      },
      process.cwd(),
    );
    const current = getRunStatus(stateDir);
    const result = killRun(stateDir, {
      ownerId: "session-a",
      runInstanceId: "superseded-instance",
    });
    assert.equal(result.killed, false);
    assert.equal(result.reason, "run generation changed");
    assert.equal(getRunStatus(stateDir).status, "running");
    assert.equal(
      getRunStatus(stateDir).run_instance_id,
      current.run_instance_id,
    );
  } finally {
    try {
      killRun(stateDir);
    } catch {
      /* best effort */
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("Same-directory restart cannot cross held canonical control", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-control-restart-race-"));
  const stateDir = join(root, "replacement");
  const readyPath = join(root, "control-ready");
  const releasePath = join(root, "control-release");
  const blockedPath = join(root, "restart-blocked");
  const controlConfig = join(root, "control.json");
  const restartConfig = join(root, "restart.json");
  try {
    startRun(
      {
        ownerId: "session-a",
        run_id: "replacement",
        state_dir: stateDir,
        template: `${process.execPath} -e "setTimeout(() => {}, 150)"`,
      },
      process.cwd(),
    );
    const initial = getRunStatus(stateDir);
    await writeFile(controlConfig, JSON.stringify({
      mode: "control",
      readyPath,
      releasePath,
      stateDir,
    }));
    await writeFile(restartConfig, JSON.stringify({
      blockedPath,
      mode: "restart",
      stateDir,
    }));
    const runWorker = (config: string) =>
      execFileAsync(process.execPath, [
        "--experimental-strip-types",
        controlRaceWorker,
        config,
      ]);
    const waitForFile = async (path: string) => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (existsSync(path)) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for ${path}`);
    };
    const settle = <T>(promise: Promise<T>) =>
      promise.then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ error, ok: false as const }),
      );
    const control = settle(runWorker(controlConfig));
    await waitForFile(readyPath);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const restart = settle(runWorker(restartConfig));
    await waitForFile(blockedPath);
    try {
      assert.equal(getRunStatus(stateDir).run_instance_id, initial.run_instance_id);
      assert.notEqual(getRunStatus(stateDir).status, "running");
    } finally {
      await writeFile(releasePath, "release\n");
    }
    const outcomes = await Promise.all([control, restart]);
    assert.equal(outcomes[0]!.ok, true);
    assert.equal(outcomes[1]!.ok, true);
    const replacement = getRunStatus(stateDir);
    assert.equal(replacement.status, "running");
    assert.notEqual(replacement.run_instance_id, initial.run_instance_id);
    assert.equal(replacement.ownerId, "session-b");
  } finally {
    try {
      killRun(stateDir);
    } catch {
      /* best effort */
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("Parent teardown kills only exact-session runs through canonical run control", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-parent-teardown-"));
  const ownedDir = join(root, "owned");
  const otherDir = join(root, "other");
  try {
    startRun(
      {
        ownerId: "session-a",
        run_id: "owned",
        state_dir: ownedDir,
        template: `${process.execPath} -e "setTimeout(() => {}, 5000)"`,
      },
      process.cwd(),
    );
    startRun(
      {
        ownerId: "session-b",
        run_id: "other",
        state_dir: otherDir,
        template: `${process.execPath} -e "setTimeout(() => {}, 5000)"`,
      },
      process.cwd(),
    );
    for (let i = 0; i < 20; i++) {
      if (
        getRunStatus(ownedDir).status === "running" &&
        getRunStatus(otherDir).status === "running"
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const result = teardownRunsOwnedByParent("session-a", root, {
      trigger: "session_shutdown:quit",
    });
    assert.equal(result.killed, 1);
    assert.equal(result.failed, 0);
    assert.equal(typeof result.summaryPath, "string");
    const teardownSummary = JSON.parse(
      await readFile(result.summaryPath!, "utf8"),
    );
    assert.equal(teardownSummary.ownerId, "session-a");
    assert.equal(teardownSummary.trigger, "session_shutdown:quit");
    assert.equal(teardownSummary.killed, 1);
    assert.equal(
      (await waitForStatus(ownedDir, "killed", process.platform === "win32" ? 200 : 40))
        .status,
      "killed",
    );
    assert.equal(getRunStatus(otherDir).status, "running");
    const trace = await readFile(join(ownedDir, "trace.jsonl"), "utf8");
    assert.match(trace, /"kind":"run\.kill"/);
    assert.match(trace, /"kind":"run\.parent_teardown"/);
    assert.doesNotMatch(trace, /"type":"control\.kill"/);
    assert.match(trace, /"trigger":"session_shutdown:quit"/);
  } finally {
    try {
      killRun(otherDir);
    } catch {
      /* best effort */
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("Parent teardown persists corrupt-state discovery failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-parent-teardown-corrupt-"));
  const corruptDir = join(root, "corrupt");
  try {
    await mkdir(corruptDir, { recursive: true });
    await writeFile(join(corruptDir, "run.json"), "{not-json\n");
    const result = teardownRunsOwnedByParent("session-a", root, {
      trigger: "session_shutdown:reload",
    });
    assert.equal(result.attempted, 0);
    assert.equal(result.discoveryFailed, 1);
    assert.equal(result.failed, 1);
    assert.equal(typeof result.summaryPath, "string");
    const summary = JSON.parse(await readFile(result.summaryPath!, "utf8"));
    assert.equal(summary.discoveryFailed, 1);
    assert.equal(summary.discoveryFailures[0].path, corruptDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async run retirement smoke stops supervisor after nested child is terminal", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-retire-smoke-"));
  const supervisorDir = join(root, "supervisor");
  const childDir = join(supervisorDir, "child");
  const serviceDir = join(root, "service");
  try {
    startRun(
      {
        run_id: "supervisor",
        state_dir: supervisorDir,
        retire_when: "children_terminal",
        template: `${process.execPath} -e "setInterval(() => {}, 1000)"`,
      },
      process.cwd(),
    );
    startRun(
      {
        run_id: "child",
        state_dir: childDir,
        template: `${process.execPath} -e "console.log('child done')"`,
      },
      process.cwd(),
    );
    startRun(
      {
        run_id: "service",
        state_dir: serviceDir,
        template: `${process.execPath} -e "setInterval(() => {}, 1000)"`,
      },
      process.cwd(),
    );
    await waitForResult(childDir);
    await writeFile(
      join(supervisorDir, "progress.json"),
      JSON.stringify({ activeSubagents: 0, completed: 1, failures: [], updatedAt: new Date().toISOString() }),
    );
    const summary = summarizeRuns(root);
    assert.deepEqual(
      summary.runs.map((run) => run.run).sort(),
      ["child", "service", "supervisor"],
    );
    const results = await executeRunRetirements(summary, {
      cancelRun: (candidate) => cancelRun(candidate.stateDir),
      sendStop: async () => { throw new Error("no actor-local stop action"); },
    });
    assert.deepEqual(results, [
      { action: "cancel", run: "supervisor", stateDir: supervisorDir },
    ]);
    assert.equal((await waitForStatus(supervisorDir, "cancelled", 200)).status, "cancelled");
    assert.equal(getRunStatus(childDir).status, "done");
    assert.equal(getRunStatus(serviceDir).status, "running");
    assert.match(
      await readFile(join(supervisorDir, "trace.jsonl"), "utf8"),
      /"kind":"run\.cancel"/,
    );
  } finally {
    try {
      cancelRun(supervisorDir);
    } catch {
      // Best-effort cleanup for the long-running supervisor process.
    }
    try {
      cancelRun(serviceDir);
    } catch {
      // Best-effort cleanup for the non-retiring service process.
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("Async run cancel consistently classifies completed-run races as not running", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-runs-completed-cancel-"));
  try {
    for (let iteration = 0; iteration < 30; iteration += 1) {
      const stateDir = join(root, `done-${iteration}`);
      startRun(
        {
          run_id: `done-${iteration}`,
          state_dir: stateDir,
          template: `${process.execPath} -e "console.log('done')"`,
        },
        process.cwd(),
      );
      await waitForResult(stateDir);
      const result = cancelRun(stateDir);
      assert.equal(result.cancelled, false, JSON.stringify(result));
      assert.equal(result.reason, "not running", JSON.stringify(result));
      assert.equal("process_identity_status" in result, false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async run state index rebuilds and corrupt index falls back", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-index-"));
  const parentDir = join(root, "parent");
  const childDir = join(parentDir, "child");
  try {
    startRun(
      {
        ownerId: "session-a",
        run_id: `index-parent-${process.pid}-${Date.now()}`,
        state_dir: parentDir,
        template: `${process.execPath} -e "console.log('parent')"`,
        tool: "parent-tool",
      },
      process.cwd(),
    );
    startRun(
      {
        ownerId: "session-a",
        run_id: `index-child-${process.pid}-${Date.now()}`,
        state_dir: childDir,
        template: `${process.execPath} -e "console.log('child')"`,
        name: "child-recipe",
      },
      process.cwd(),
    );
    await waitForResult(parentDir);
    await waitForResult(childDir);
    const index = rebuildRunStateIndex(root);
    assert.equal(index.length, 2);
    assert.deepEqual(index.map((entry) => entry.state_dir).sort(), [childDir, parentDir].sort());
    assert.equal(readRunStateIndex(root)?.length, 2);
    assert.equal(listRuns(root, "done").length, 2);
    await writeFile(join(root, "index.json"), "not-json");
    assert.equal(listRuns(root, "done").length, 2);
    assert.equal(readRunStateIndex(root)?.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run retention journal keeps a bounded valid tail", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-retention-bound-"));
  const stateDir = join(root, "run");
  try {
    await mkdir(stateDir);
    const status = { run: "bounded", run_instance_id: "generation-a", state_dir: stateDir };
    await writeFile(join(root, "retention.jsonl"), `{bad json\n${JSON.stringify({ id: "legacy" })}\n`);
    for (let index = 0; index <= Limits.RUN_RETENTION_MAX_RECORDS; index += 1) {
      appendRunRetentionEvidence(status, "archive", "queued", { id: `retention-${index}` });
    }
    const content = await readFile(join(root, "retention.jsonl"), "utf8");
    const records = content.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records.length, Limits.RUN_RETENTION_MAX_RECORDS);
    assert.ok(Buffer.byteLength(content) <= Limits.RUN_RETENTION_MAX_BYTES);
    assert.equal(records[0].id, "retention-1");
    assert.equal(records.at(-1).id, `retention-${Limits.RUN_RETENTION_MAX_RECORDS}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Async run archive and prune only allow terminal run state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-retention-"));
  const activeDir = join(root, "active");
  const doneDir = join(root, "done");
  const pruneDir = join(root, "prune");
  const failedPruneDir = join(root, "failed-prune");
  try {
    startRun(
      {
        run_id: `active-${process.pid}-${Date.now()}`,
        state_dir: activeDir,
        template: `${process.execPath} -e "setTimeout(() => {}, 3000)"`,
      },
      process.cwd(),
    );
    assert.throws(() => archiveRun(activeDir), /Only terminal runs/);
    assert.throws(() => pruneRun(activeDir), /Only terminal runs/);
    killRun(activeDir);
    startRun(
      {
        run_id: `archive-${process.pid}-${Date.now()}`,
        state_dir: doneDir,
        template: `${process.execPath} -e "console.log('done')"`,
      },
      process.cwd(),
    );
    await waitForResult(doneDir);
    for (let index = 0; index < Limits.TRACE_JOURNAL_MAX_EVENTS + 1; index += 1)
      appendRunTraceEvent(doneDir, { kind: "archive.pressure", data: { index } });
    const archived = archiveRun(doneDir);
    assert.equal(archived.archived, true);
    await readFile(join(doneDir, "archive-tombstone.json"), "utf8");
    const archiveDir = String(archived.archive_dir);
    await readFile(join(archiveDir, "run.json"), "utf8");
    const archivedTrace = readRunTraceJournal(archiveDir);
    assert.equal(summarizeRunTraceJournal(archivedTrace).compacted, true);
    assert.ok(archivedTrace.fileBytes <= Limits.TRACE_JOURNAL_MAX_BYTES);
    startRun(
      {
        artifacts: {
          first: { path: "{state_dir}/one/report.txt", required: true },
          second: { path: "{state_dir}/two/report.txt", required: true },
          optional: { path: "{state_dir}/missing/report.txt", required: false },
        },
        run_id: `prune-${process.pid}-${Date.now()}`,
        state_dir: pruneDir,
        template: `${process.execPath} -e "console.log('done')"`,
      },
      process.cwd(),
    );
    await waitForResult(pruneDir);
    await mkdir(join(pruneDir, "one"), { recursive: true });
    await mkdir(join(pruneDir, "two"), { recursive: true });
    await writeFile(join(pruneDir, "one", "report.txt"), "first");
    await writeFile(join(pruneDir, "two", "report.txt"), "second");
    const pruned = pruneRun(pruneDir, { preserveArtifacts: true });
    assert.equal(pruned.pruned, true);
    const preserved = pruned.preserved_artifacts as Record<string, string>;
    assert.notEqual(preserved.first, preserved.second);
    assert.equal(await readFile(preserved.first, "utf8"), "first");
    assert.equal(await readFile(preserved.second, "utf8"), "second");
    assert.equal(preserved.optional, undefined);
    assert.throws(() => getRunStatus(pruneDir), /Run not found/);
    const retention = (await readFile(join(root, "retention.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      retention.map((record) => [record.action, record.outcome]),
      [
        ["archive", "queued"],
        ["archive", "handled"],
        ["prune", "queued"],
        ["prune", "handled"],
      ],
    );
    assert.equal(retention[0].id, retention[1].id);
    assert.equal(retention[2].id, retention[3].id);
    assert.equal(archived.retention_id, retention[0].id);
    assert.equal(pruned.retention_id, retention[2].id);
    startRun(
      {
        artifacts: { report: { path: "{state_dir}/report.txt", required: true } },
        run_id: `failed-prune-${process.pid}-${Date.now()}`,
        state_dir: failedPruneDir,
        template: `${process.execPath} -e "console.log('done')"`,
      },
      process.cwd(),
    );
    await waitForResult(failedPruneDir);
    await writeFile(join(failedPruneDir, "report.txt"), "keep");
    assert.throws(
      () =>
        pruneTerminalRun(
          getRunStatus(failedPruneDir),
          { preserveArtifacts: true },
          { copyArtifact: () => { throw new Error("simulated copy failure"); } },
        ),
      /simulated copy failure/,
    );
    await readFile(join(failedPruneDir, "run.json"), "utf8");
    assert.equal(await readFile(join(failedPruneDir, "report.txt"), "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
