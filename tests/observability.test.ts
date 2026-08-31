/**
 * Async run observability regression tests
 * Covers compact ambient summaries and terminal transition detection
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { FSWatcher } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  countRunningSubagents,
  createRunStateWatcher,
  createRunTerminalReconciliationLoop,
  createRunUiObservationState,
  detectRunAttentionEvents,
  detectRunTransitions,
  deliverRunAttentionNotifications,
  deliverRunTransitionNotifications,
  executeRunRetirements,
  findRunRetirementCandidates,
  primeRunAttentionState,
  pruneRunObservationState,
  readRunUiSnapshot,
  reconcileRunTerminalNotifications,
  formatRunAttentionMessage,
  formatRunTransitionMessage,
  getRunAttentionNotificationType,
  getRunTransitionNotificationType,
  renderRunStatus,
  renderSubagentStatus,
  shouldNotifyRunAttentionEvent,
  shouldNotifyRunTransition,
  shouldSendRunAttentionFollowUp,
  shouldSendRunTransitionFollowUp,
  summarizeRuns,
} from "../lib/observability.ts";
import { readProcessIdentity } from "../lib/runs-process.ts";
import * as Limits from "../lib/limits.ts";
import { appendRunTraceEvent } from "../lib/runs-trace.ts";

async function writeRun(
  root: string,
  run: string,
  status: "running" | "done" | "failed" | "exited" | "cancelled" | "killed",
  failures: unknown[] = [],
  activeSubagents = 0,
  ownerId?: string,
  retireWhen?: string,
  launchSource?: "spawn" | "tool",
  recipeFile?: string,
  tool?: string,
  notificationPolicy?: "normal" | "silent",
): Promise<void> {
  const dir = join(root, run);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "run.json"),
    JSON.stringify({
      createdAt: "2026-01-01T00:00:00.000Z",
      cwd: process.cwd(),
      run,
      ...(ownerId ? { ownerId } : {}),
      ...(retireWhen ? { retire_when: retireWhen } : {}),
      ...(launchSource ? { launch_source: launchSource } : {}),
      ...(recipeFile ? { recipe_file: recipeFile } : {}),
      ...(tool ? { tool } : {}),
      ...(notificationPolicy ? { notification_policy: notificationPolicy } : {}),
      pid: status === "running" ? process.pid : 999999999,
      ...(status === "running"
        ? { process_identity: readProcessIdentity(process.pid) }
        : {}),
      state_dir: dir,
    }),
  );
  await writeFile(
    join(dir, "progress.json"),
    JSON.stringify({
      activeSubagents,
      completed: status === "running" ? 0 : 1,
      failures,
      updatedAt: `2026-01-01T00:00:0${run.length}.000Z`,
    }),
  );
  if (status === "done")
    await writeFile(join(dir, "result.json"), JSON.stringify({ code: 0 }));
  if (status === "failed")
    await writeFile(join(dir, "result.json"), JSON.stringify({ code: 1 }));
  if (status === "cancelled")
    await writeFile(
      join(dir, "events.jsonl"),
      JSON.stringify({ event: "run.cancel" }),
    );
  if (status === "killed")
    await writeFile(
      join(dir, "events.jsonl"),
      JSON.stringify({ event: "run.kill" }),
    );
}

test("Run observability summarizes state root", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-"));
  try {
    await writeRun(root, "running", "running");
    await writeRun(root, "done", "done");
    await writeRun(root, "failed", "failed");
    await writeRun(root, "cancelled", "cancelled");
    await writeRun(root, "killed", "killed");
    const summary = summarizeRuns(root);
    assert.equal(summary.total, 5);
    assert.equal(summary.running, 1);
    assert.equal(summary.done, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.cancelled, 1);
    assert.equal(summary.killed, 1);
    assert.equal(summary.runningSubagents, 1);
    assert.equal(renderRunStatus(summary), "▶");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability discovers nested child async runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-nested-"));
  try {
    await writeRun(root, "supervisor", "running", [], 0, undefined, "children_terminal");
    const childDir = join(root, "supervisor", "child");
    await mkdir(childDir, { recursive: true });
    await writeFile(
      join(childDir, "run.json"),
      JSON.stringify({
        createdAt: "2026-01-01T00:00:00.000Z",
        cwd: process.cwd(),
        pid: 999999999,
        run: "child",
        state_dir: childDir,
      }),
    );
    await writeFile(
      join(childDir, "progress.json"),
      JSON.stringify({ activeSubagents: 0, completed: 1, failures: [], updatedAt: "2026-01-01T00:00:09.000Z" }),
    );
    await writeFile(join(childDir, "result.json"), JSON.stringify({ code: 0 }));
    const summary = summarizeRuns(root);
    assert.deepEqual(summary.runs.map((run) => run.run), ["child", "supervisor"]);
    assert.deepEqual(findRunRetirementCandidates(summary), [
      {
        activeSubagents: 0,
        childRuns: 1,
        descendantSubagents: 0,
        run: "supervisor",
        stateDir: join(root, "supervisor"),
        terminalChildRuns: 1,
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability filters summaries by coordinator owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-"));
  try {
    await writeRun(root, "alpha", "running", [], 3, "session-a");
    await writeRun(root, "beta", "running", [], 2, "session-b");
    await writeRun(root, "global", "running", [], 4);
    const summaryA = summarizeRuns(root, "session-a");
    const summaryB = summarizeRuns(root, "session-b");
    assert.deepEqual(
      summaryA.runs.map((run) => run.run),
      ["alpha"],
    );
    assert.equal(summaryA.runningSubagents, 3);
    assert.deepEqual(
      summaryB.runs.map((run) => run.run),
      ["beta"],
    );
    assert.equal(summaryB.runningSubagents, 2);
    assert.equal(summarizeRuns(root).total, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability detects script-authored Trace attention", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-"));
  try {
    await writeRun(root, "music", "running", [], 0, "session-a");
    await writeFile(
      join(root, "music", "trace.jsonl"),
      `${JSON.stringify({ id: "trace-1", kind: "player.track", summary: "Now playing: track.flac", attention: "followup", level: "info", data: { index: 3, question: "Continue playback?", artifacts: { report: join(root, "music", "report.md") }, run_files: [join(root, "music", "stdout.log")] }, ts: "2026-01-01T00:00:00.000Z" })}\n`,
    );
    const summary = summarizeRuns(root, "session-a");
    const previous = new Map<string, number>();
    const seen = new Map<string, Set<string>>();
    const events = detectRunAttentionEvents(previous, summary, seen);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "player.track");
    assert.equal(events[0].summary, "Now playing: track.flac");
    assert.equal(events[0].body, undefined);
    assert.equal(events[0].metadata, undefined);
    assert.equal(
      formatRunAttentionMessage(events[0]),
      `Run music: Now playing: track.flac\nArtifacts:\n- Base: \`${join(root, "music")}\`\n- Files: \`report.md\`\nRun files:\n- Base: \`${join(root, "music")}\`\n- Files: \`stdout.log\``,
    );
    assert.equal(getRunAttentionNotificationType(events[0]), "info");
    assert.equal(shouldNotifyRunAttentionEvent(events[0]), true);
    assert.equal(shouldSendRunAttentionFollowUp(events[0]), true);
    const delivered: Array<{ customType: string }> = [];
    deliverRunAttentionNotifications(events, {
      notify: () => {},
      sendFollowUp: (message) => delivered.push(message),
    });
    assert.deepEqual(
      delivered.map((message) => message.customType),
      ["pi-actors-run-trace"],
    );
    assert.deepEqual(detectRunAttentionEvents(previous, summary, seen), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability keeps canonical attention exactly-once across replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-replace-"));
  const stateDir = join(root, "music");
  try {
    await writeRun(root, "music", "running", [], 0, "session-a");
    const first = appendRunTraceEvent(stateDir, {
      attention: "notify",
      kind: "player.first",
    });
    const summary = summarizeRuns(root, "session-a");
    const legacy = new Map<string, number>();
    const seen = new Map<string, Set<string>>();
    assert.deepEqual(
      detectRunAttentionEvents(legacy, summary, seen).map(({ id }) => id),
      [first.id],
    );
    assert.deepEqual(detectRunAttentionEvents(legacy, summary, seen), []);
    const second = {
      id: "replacement-second",
      kind: "player.second",
      ts: "2026-01-01T00:00:01.000Z",
      attention: "followup",
    };
    await writeFile(
      join(stateDir, "trace.jsonl"),
      `${JSON.stringify(second)}\n`,
    );
    assert.deepEqual(
      detectRunAttentionEvents(legacy, summary, seen).map(({ id }) => id),
      [second.id],
    );
    assert.equal(seen.get(stateDir)?.has(first.id), false);
    assert.deepEqual(detectRunAttentionEvents(legacy, summary, seen), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability delivers multiple unseen retained attention in physical order", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-multiple-"));
  const stateDir = join(root, "music");
  try {
    await writeRun(root, "music", "running", [], 0, "session-a");
    await writeFile(
      join(stateDir, "trace.jsonl"),
      [
        { id: "first", kind: "player.first", ts: "2026-01-01T00:00:02.000Z", attention: "notify" },
        { id: "marker", kind: "runtime.trace_compacted", ts: "2026-01-01T00:00:03.000Z", level: "warning", data: { version: 1, compactions_total: 1, dropped_valid_events_total: 1, dropped_malformed_lines_total: 0, dropped_bytes_total: 10, dropped_event_count_exact: true, retained_events: 3, retained_bytes: 400, history_complete: false } },
        { id: "second", kind: "player.second", ts: "2026-01-01T00:00:01.000Z", attention: "followup" },
      ].map((value) => JSON.stringify(value)).join("\n") + "\n",
    );
    const events = detectRunAttentionEvents(
      new Map(),
      summarizeRuns(root, "session-a"),
      new Map(),
    );
    assert.deepEqual(events.map(({ id }) => id), ["first", "second"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability primes retained attention without startup replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-prime-"));
  const stateDir = join(root, "music");
  try {
    await writeRun(root, "music", "running", [], 0, "session-a");
    const historical = appendRunTraceEvent(stateDir, {
      attention: "followup",
      kind: "player.historical",
    });
    const state = createRunUiObservationState();
    primeRunAttentionState(state, "session-a", root);
    assert.deepEqual(readRunUiSnapshot(state, "session-a", { stateRoot: root }).attentionEvents, []);
    const current = appendRunTraceEvent(stateDir, {
      attention: "notify",
      kind: "player.current",
    });
    assert.deepEqual(
      readRunUiSnapshot(state, "session-a", { stateRoot: root })
        .attentionEvents.map(({ id }) => id),
      [current.id],
    );
    assert.deepEqual(state.attentionEventIds.get(stateDir), new Set([historical.id, current.id]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability delivers retained attention once across repeated compaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-compaction-"));
  const stateDir = join(root, "music");
  try {
    await writeRun(root, "music", "running", [], 0, "session-a");
    const state = createRunUiObservationState();
    primeRunAttentionState(state, "session-a", root);
    const delivered: string[] = [];
    for (let cycle = 0; cycle < 2; cycle += 1) {
      for (let index = 0; index < Limits.TRACE_JOURNAL_MAX_EVENTS - 2; index += 1)
        appendRunTraceEvent(stateDir, { kind: "player.pressure", data: { cycle, index } });
      const attention = appendRunTraceEvent(stateDir, {
        attention: cycle ? "followup" : "notify", kind: `player.cycle_${cycle}`,
      });
      const first = readRunUiSnapshot(state, "session-a", { stateRoot: root });
      delivered.push(...first.attentionEvents.map(({ id }) => id));
      assert.equal(first.attentionEvents.filter(({ id }) => id === attention.id).length, 1);
      appendRunTraceEvent(stateDir, { kind: "player.compact", data: { cycle } });
      assert.deepEqual(readRunUiSnapshot(state, "session-a", { stateRoot: root }).attentionEvents, []);
      assert.ok((state.attentionEventIds.get(stateDir)?.size ?? 0) <= 1);
    }
    const finalAttention = appendRunTraceEvent(stateDir, {
      attention: "notify", kind: "player.final",
    });
    delivered.push(...readRunUiSnapshot(state, "session-a", { stateRoot: root })
      .attentionEvents.map(({ id }) => id));
    assert.equal(new Set(delivered).size, 3);
    assert.equal(delivered.at(-1), finalAttention.id);
    assert.deepEqual(readRunUiSnapshot(state, "session-a", { stateRoot: root }).attentionEvents, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability suppresses duplicate legacy attention after line counter reset", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-dedupe-"));
  try {
    await writeRun(root, "music", "running", [], 0, "session-a");
    await writeFile(
      join(root, "music", "outbox.jsonl"),
      `${JSON.stringify({ id: "event-1", event: "player.track", summary: "Now playing", delivery: "followup" })}\n`,
    );
    const summary = summarizeRuns(root, "session-a");
    const previous = new Map<string, number>();
    const seen = new Map<string, Set<string>>();
    assert.equal(detectRunAttentionEvents(previous, summary, seen).length, 1);
    previous.clear();
    assert.equal(detectRunAttentionEvents(previous, summary, seen).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability skips malformed legacy attention records", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-corrupt-outbox-"));
  try {
    await writeRun(root, "music", "running", [], 0, "session-a");
    await writeFile(
      join(root, "music", "outbox.jsonl"),
      `{bad json\n${JSON.stringify({ id: "event-1", event: "player.track", summary: "Now playing", delivery: "followup" })}\n`,
    );
    const summary = summarizeRuns(root, "session-a");
    const previous = new Map<string, number>();
    const events = detectRunAttentionEvents(previous, summary);
    assert.equal(events.length, 1);
    assert.equal(events[0].id, "event-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability bounds seen attention ids to the retained canonical set", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-bounded-seen-"));
  const stateDir = join(root, "music");
  try {
    await writeRun(root, "music", "running", [], 0, "session-a");
    const legacy = new Map<string, number>();
    const seen = new Map<string, Set<string>>();
    for (let index = 0; index < 20; index += 1) {
      const record = {
        id: `event-${index}`,
        kind: "player.track",
        ts: new Date(index).toISOString(),
        attention: "notify",
      };
      await writeFile(join(stateDir, "trace.jsonl"), `${JSON.stringify(record)}\n`);
      assert.equal(
        detectRunAttentionEvents(
          legacy,
          summarizeRuns(root, "session-a"),
          seen,
        ).length,
        1,
      );
      assert.deepEqual(seen.get(stateDir), new Set([record.id]));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability detects terminal transitions", () => {
  const previous = new Map([["review", "running" as const]]);
  const transitions = detectRunTransitions(previous, {
    cancelled: 0,
    done: 1,
    exited: 0,
    failed: 0,
    killed: 0,
    running: 0,
    runningSubagents: 0,
    runs: [
      {
        artifacts: { report: "artifacts/report.md" },
        run: "review",
        status: "done",
      },
    ],
    total: 1,
  });
  assert.deepEqual(transitions, [
    {
      from: "running",
      artifacts: { report: "artifacts/report.md" },
      run: "review",
      to: "done",
    },
  ]);
  assert.equal(
    formatRunTransitionMessage(transitions[0]),
    "Run: `review`\nStatus: `done`\nBase: `artifacts`\nArtifacts: `report.md`",
  );
  assert.equal(previous.get("review"), "done");
});

test("Terminal reconciliation is independent of retained Trace history", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-terminal-trace-"));
  const stateDir = join(root, "review");
  try {
    await writeRun(root, "review", "done", [], 0, "session-a");
    await writeFile(join(stateDir, "trace.jsonl"), "{compacted away}\n");
    const transitions = detectRunTransitions(new Map([[stateDir, "running" as const]]),
      summarizeRuns(root, "session-a"));
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0]?.to, "done");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability bounds terminal artifact references", () => {
  const message = formatRunTransitionMessage({
    artifacts: {
      one: "/reports/one.md",
      two: "/reports/two.md",
      three: "/reports/three.md",
      four: "/reports/four.md",
      five: "/reports/five.md",
    },
    from: "running",
    run: "review",
    to: "done",
  });
  assert.match(
    message,
    /Base: `\/reports`\nArtifacts: `one\.md`, `two\.md`, `three\.md`, `four\.md` \(\+1 more\)/,
  );
  assert.doesNotMatch(message, /five\.md/);
});

test("Successful reviews keep semantic output out of follow-up context", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-semantic-review-"));
  const stateDir = join(root, "review");
  try {
    await writeRun(root, "review", "done", [], 0, "session-a");
    const meta = JSON.parse(await readFile(join(stateDir, "run.json"), "utf8"));
    await writeFile(
      join(stateDir, "run.json"),
      JSON.stringify({
        ...meta,
        launch_correlation: {
          correlation_id: "task-42",
          tool_call_id: "call-17",
        },
        transport_context: {
          transport: "telegram",
          chat_id: 123456,
          thread_id: 77,
        },
      }),
    );
    await writeFile(
      join(stateDir, "stdout.log"),
      `ACTOR_REVIEW_RESULT\nStatus: complete\nFinding: ${"x".repeat(6_000)}\n`,
    );
    const previous = new Map([[stateDir, "running" as const]]);
    const [transition] = detectRunTransitions(
      previous,
      summarizeRuns(root, "session-a"),
    );
    assert.equal(transition.semanticResult?.type, "run.done");
    assert.equal(transition.semanticResult?.synthesized, true);
    assert.equal(transition.semanticResult?.correlationId, "task-42");
    assert.match(transition.semanticResult?.body ?? "", /^Status: complete/);
    assert.equal((transition.semanticResult?.body?.length ?? 0) <= 4_000, true);
    const delivered: Array<{
      content: string;
      details: unknown;
      display: false;
    }> = [];
    deliverRunTransitionNotifications([transition], {
      notify: () => {},
      sendFollowUp: (message) => delivered.push(message),
    });
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].display, false);
    assert.equal(
      delivered[0].content,
      `Run: \`review\`\nStatus: \`done\`\nBase: \`${stateDir}\``,
    );
    assert.doesNotMatch(delivered[0].content, /Status: complete|Finding:|x{100}/);
    assert.equal(
      (delivered[0].details as { semanticResult?: { correlationId?: string } })
        .semanticResult?.correlationId,
      "task-42",
    );
    assert.match(
      (delivered[0].details as { semanticResult?: { body?: string } })
        .semanticResult?.body ?? "",
      /^Status: complete/,
    );
    assert.deepEqual(
      (delivered[0].details as {
        semanticResult?: { metadata?: { transport_context?: unknown } };
      }).semanticResult?.metadata?.transport_context,
      {
        transport: "telegram",
        chat_id: 123456,
        thread_id: 77,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Failed runs retain terminal errors outside follow-up context", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-semantic-failed-"));
  const stateDir = join(root, "review");
  try {
    await writeRun(root, "review", "failed", [], 0, "session-a");
    await writeFile(
      join(stateDir, "result.json"),
      JSON.stringify({ code: 65, error: "accepted review output missing" }),
    );
    const [transition] = detectRunTransitions(
      new Map([[stateDir, "running" as const]]),
      summarizeRuns(root, "session-a"),
    );
    assert.equal(transition.semanticResult?.type, "run.failed");
    assert.equal(transition.semanticResult?.body, "accepted review output missing");
    const content = formatRunTransitionMessage(transition);
    assert.match(content, /Run: `review`\nStatus: `failed`/);
    assert.doesNotMatch(content, /accepted review output missing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Silent background runs emit no terminal transition", () => {
  const previous = new Map([["draft-sleep", "running" as const]]);
  const transitions = detectRunTransitions(previous, {
    cancelled: 0,
    done: 1,
    exited: 0,
    failed: 0,
    killed: 0,
    running: 0,
    runningSubagents: 0,
    runs: [{
      notificationPolicy: "silent",
      run: "draft-sleep",
      status: "done",
    }],
    total: 1,
  });
  assert.deepEqual(transitions, []);
  assert.equal(previous.get("draft-sleep"), "done");
});

test("Run observability keeps model policy out of terminal follow-up context", () => {
  const message = formatRunTransitionMessage({
    from: "running",
    modelPolicy: {
      model: { source: "inherited", value: "provider/model" },
      thinking: { source: "explicit", value: "high" },
    },
    run: "review",
    to: "done",
  });
  assert.doesNotMatch(message, /Policy:|provider\/model|high/);
});

test("Run observability keys transitions by state directory", () => {
  const previous = new Map([
    ["/tmp/parent/review", "running" as const],
    ["/tmp/parent/child/review", "running" as const],
  ]);
  const transitions = detectRunTransitions(previous, {
    cancelled: 0,
    done: 1,
    exited: 0,
    failed: 1,
    killed: 0,
    running: 0,
    runningSubagents: 0,
    runs: [
      { run: "review", stateDir: "/tmp/parent/review", status: "done" },
      { run: "review", stateDir: "/tmp/parent/child/review", status: "failed" },
    ],
    total: 2,
  });
  assert.deepEqual(
    transitions.map((transition) => ({
      from: transition.from,
      run: transition.run,
      stateDir: transition.stateDir,
      to: transition.to,
    })),
    [
      { from: "running", run: "review", stateDir: "/tmp/parent/review", to: "done" },
      { from: "running", run: "review", stateDir: "/tmp/parent/child/review", to: "failed" },
    ],
  );
  assert.equal(previous.get("/tmp/parent/review"), "done");
  assert.equal(previous.get("/tmp/parent/child/review"), "failed");
});

test("Run observability suppresses terminal follow-up after handled stop messages", () => {
  const transition = {
    from: "running" as const,
    run: "music",
    terminalHandled: true,
    to: "done" as const,
  };
  assert.equal(shouldNotifyRunTransition(transition), false);
  assert.equal(shouldSendRunTransitionFollowUp(transition), false);
});

test("Run observability keeps legacy command completion out of user projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-"));
  try {
    await writeRun(root, "review", "running", [], 0, "session-a");
    await writeFile(
      join(root, "review", "trace.jsonl"),
      `${JSON.stringify({ id: "command-done", kind: "command.done", summary: "Command pi completed with code 0", attention: "followup", level: "info", data: { artifacts: { report: join(root, "review", "report.md") }, run_files: [join(root, "review", "stdout.log")] }, ts: new Date().toISOString() })}\n`,
    );
    assert.deepEqual(
      detectRunAttentionEvents(
        new Map<string, number>(),
        summarizeRuns(root, "session-a"),
      ),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Terminal reconciliation supersedes retained command completion attention", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-terminal-supersession-"));
  const stateDir = join(root, "review");
  try {
    await writeRun(root, "review", "done", [], 0, "session-a");
    appendRunTraceEvent(stateDir, {
      attention: "followup",
      kind: "command.done",
      summary: "Reviewer branch completed",
    });
    const delivered: Array<{ customType: string }> = [];
    const state = createRunUiObservationState();
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
    assert.deepEqual(
      delivered.map((message) => message.customType),
      ["pi-actors-run"],
    );
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
    assert.equal(delivered.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability detects failed terminal transitions", () => {
  const previous = new Map([["review", "running" as const]]);
  const transitions = detectRunTransitions(previous, {
    cancelled: 0,
    done: 0,
    exited: 0,
    failed: 1,
    killed: 0,
    running: 0,
    runningSubagents: 0,
    runs: [{ run: "review", status: "failed" }],
    total: 1,
  });
  assert.deepEqual(transitions, [
    { from: "running", run: "review", to: "failed" },
  ]);
});

test("Terminal reconciliation contains a throwing error handler", () => {
  const loop = createRunTerminalReconciliationLoop({
    onError: () => {
      throw new Error("notification context is stale");
    },
    reconcile: () => {
      throw new Error("reconciliation failed");
    },
    refreshWatcher: () => undefined,
  });
  assert.doesNotThrow(() => loop.reconcileNow());
  loop.close();
});

test("Periodic terminal reconciliation delivers without a watcher event", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-terminal-periodic-"));
  const stateDir = join(root, "review");
  const secondStateDir = join(root, "audit");
  const foreignStateDir = join(root, "foreign");
  let loop: ReturnType<typeof createRunTerminalReconciliationLoop> | undefined;
  const degradedWatcher = createRunStateWatcher({
    stateRoot: root,
    onChange: () => assert.fail("watch callback should remain unused"),
    watchPath: () => {
      throw new Error("watch unavailable");
    },
  });
  try {
    await writeRun(root, "review", "done", [], 0, "session-a");
    await writeRun(root, "audit", "done", [], 0, "session-a");
    await writeRun(root, "foreign", "done", [], 0, "session-b");
    const delivered: unknown[] = [];
    const state = createRunUiObservationState();
    loop = createRunTerminalReconciliationLoop({
      intervalMs: 10,
      reconcile: () =>
        reconcileRunTerminalNotifications({
          ownerId: "session-a",
          sink: {
            notify: () => {},
            sendFollowUp: (message) => delivered.push(message),
          },
          state,
          stateRoot: root,
        }),
      refreshWatcher: () => degradedWatcher.refresh(),
    });
    loop.start();
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      try {
        await Promise.all([
          readFile(join(stateDir, "terminal-handled.json"), "utf8"),
          readFile(join(secondStateDir, "terminal-handled.json"), "utf8"),
        ]);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const handled = JSON.parse(
      await readFile(join(stateDir, "terminal-handled.json"), "utf8"),
    );
    assert.equal(handled.status, "done");
    assert.equal(delivered.length, 2);
    assert.equal(
      degradedWatcher
        .getDiagnostics()
        .some((diagnostic) => diagnostic.code === "attach_failed"),
      true,
    );
    await assert.rejects(
      readFile(join(foreignStateDir, "terminal-handled.json"), "utf8"),
      /ENOENT/,
    );
  } finally {
    loop?.close();
    degradedWatcher.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Periodic reconciliation recovers missed retained attention events", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-attention-reconcile-"));
  try {
    await writeRun(root, "review", "running", [], 0, "session-a");
    const state = createRunUiObservationState();
    primeRunAttentionState(state, "session-a", root);
    const event = appendRunTraceEvent(join(root, "review"), {
      attention: "notify",
      kind: "checkpoint.ready",
    });
    const notified: string[] = [];
    reconcileRunTerminalNotifications({
      includeAttention: true,
      ownerId: "session-a",
      sink: {
        notify: (message) => { notified.push(message); },
        sendFollowUp: () => {},
      },
      state,
      stateRoot: root,
    });
    assert.equal(notified.length, 1);
    assert.match(notified[0], new RegExp(event.kind));
    reconcileRunTerminalNotifications({
      includeAttention: true,
      ownerId: "session-a",
      sink: {
        notify: (message) => { notified.push(message); },
        sendFollowUp: () => {},
      },
      state,
      stateRoot: root,
    });
    assert.equal(notified.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Terminal reconciliation deduplicates a reentrant watcher race", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-terminal-race-"));
  try {
    await writeRun(root, "review", "done", [], 0, "session-a");
    const state = createRunUiObservationState();
    const inFlight = new Set<string>();
    let delivered = 0;
    const reconcile = () =>
      reconcileRunTerminalNotifications({
        inFlight,
        ownerId: "session-a",
        sink: {
          notify: () => {},
          sendFollowUp: () => {
            delivered += 1;
            if (delivered === 1) reconcile();
          },
        },
        state,
        stateRoot: root,
      });
    reconcile();
    assert.equal(delivered, 1);
    const handled = JSON.parse(
      await readFile(join(root, "review", "terminal-handled.json"), "utf8"),
    );
    assert.equal(handled.status, "done");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Terminal delivery failures stay visible and retry without a handled marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-terminal-failure-"));
  const stateDir = join(root, "review");
  try {
    await writeRun(root, "review", "done", [], 0, "session-a");
    const state = createRunUiObservationState();
    const notifications: string[] = [];
    let attempts = 0;
    const reconcile = () =>
      reconcileRunTerminalNotifications({
        ownerId: "session-a",
        sink: {
          notify: (message) => notifications.push(message),
          sendFollowUp: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("transport unavailable");
          },
        },
        state,
        stateRoot: root,
      });
    reconcile();
    assert.equal(attempts, 1);
    assert.match(notifications.at(-1) ?? "", /terminal delivery failed/);
    const failure = JSON.parse(
      await readFile(join(stateDir, "terminal-delivery-failure.json"), "utf8"),
    );
    assert.equal(failure.attempts, 1);
    assert.equal(failure.status, "done");
    assert.equal(failure.error, "transport unavailable");
    await assert.rejects(
      readFile(join(stateDir, "terminal-handled.json"), "utf8"),
      /ENOENT/,
    );
    reconcile();
    assert.equal(attempts, 2);
    const handled = JSON.parse(
      await readFile(join(stateDir, "terminal-handled.json"), "utf8"),
    );
    assert.equal(handled.status, "done");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run-state watcher records degradation and bounded rearm diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-watcher-diagnostics-"));
  const stateDir = join(root, "review");
  class FakeWatcher extends EventEmitter {
    close(): void {}
  }
  let rootAttempts = 0;
  let runWatcher: FakeWatcher | undefined;
  const watcher = createRunStateWatcher({
    stateRoot: root,
    onChange: () => {},
    watchPath: (path) => {
      if (path === root && rootAttempts++ === 0)
        throw new Error("root attach failed");
      const next = new FakeWatcher();
      if (path === stateDir) runWatcher = next;
      return next as FSWatcher;
    },
  });
  try {
    await mkdir(stateDir, { recursive: true });
    watcher.refresh();
    watcher.refresh();
    assert.ok(runWatcher);
    const initialDiagnostics = watcher.getDiagnostics();
    assert.equal(
      initialDiagnostics.some(
        (item) => item.scope === "root" && item.code === "attach_failed",
      ),
      true,
    );
    assert.equal(
      initialDiagnostics.some(
        (item) => item.scope === "root" && item.code === "rearmed",
      ),
      true,
    );
    for (let index = 0; index < 20; index += 1) {
      runWatcher?.emit("error", new Error(`watch failed ${index}`));
      watcher.refresh();
    }
    const diagnostics = watcher.getDiagnostics();
    assert.equal(diagnostics.length <= 32, true);
    assert.equal(diagnostics.some((item) => item.code === "removed"), true);
    assert.equal(diagnostics.some((item) => item.code === "rearmed"), true);
    assert.equal(
      diagnostics.some((item) => item.message.includes("watch failed")),
      true,
    );
  } finally {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Run-state watcher removes deleted run directories without degradation warnings", () => {
  const root = "/virtual/runs";
  const stateDir = `${root}/completed`;
  class FakeWatcher extends EventEmitter {
    close(): void {}
  }
  let runPresent = true;
  const watcher = createRunStateWatcher({
    exists: (path) => path === root || (path === stateDir && runPresent),
    listDirectories: () => (runPresent ? [stateDir] : []),
    onChange: () => {},
    stateRoot: root,
    watchPath: () => new FakeWatcher() as FSWatcher,
  });
  try {
    watcher.refresh();
    runPresent = false;
    watcher.refresh();
    assert.deepEqual(watcher.getDiagnostics(), []);
  } finally {
    watcher.close();
  }
});

test("Run observability replays one unhandled terminal transition after reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-terminal-replay-"));
  const stateDir = join(root, "review");
  try {
    await mkdir(stateDir, { recursive: true });
    const summary = {
      cancelled: 0,
      done: 1,
      exited: 0,
      failed: 0,
      killed: 0,
      running: 0,
      runningSubagents: 0,
      runs: [{ run: "review", stateDir, status: "done" as const }],
      total: 1,
    };
    const transitions = detectRunTransitions(new Map(), summary);
    assert.deepEqual(transitions, [
      { from: "running", run: "review", stateDir, to: "done" },
    ]);
    const steering: unknown[] = [];
    deliverRunTransitionNotifications(transitions, {
      notify: () => {},
      sendFollowUp: (message) => steering.push(message),
    });
    assert.equal(steering.length, 1);
    const handled = JSON.parse(
      await readFile(join(stateDir, "terminal-handled.json"), "utf8"),
    );
    assert.equal(handled.event, "run.notification");
    assert.equal(handled.status, "done");
    const replay = detectRunTransitions(new Map(), {
      ...summary,
      runs: [{ ...summary.runs[0], terminalHandled: true }],
    });
    assert.deepEqual(replay, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability retries unhandled terminal follow-up after delivery failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-terminal-retry-"));
  const stateDir = join(root, "review");
  try {
    await mkdir(stateDir, { recursive: true });
    const summary = {
      cancelled: 0,
      done: 1,
      exited: 0,
      failed: 0,
      killed: 0,
      running: 0,
      runningSubagents: 0,
      runs: [{ run: "review", stateDir, status: "done" as const }],
      total: 1,
    };
    const observed = new Map();
    const first = detectRunTransitions(observed, summary);
    const notifications: string[] = [];
    deliverRunTransitionNotifications(first, {
      notify: (message) => notifications.push(message),
      sendFollowUp: () => {
        throw new Error("delivery failed");
      },
    });
    assert.match(notifications.at(-1) ?? "", /terminal delivery failed/);
    await assert.rejects(
      readFile(join(stateDir, "terminal-handled.json"), "utf8"),
      /ENOENT/,
    );
    assert.equal(
      JSON.parse(await readFile(join(stateDir, "terminal-delivery-failure.json"), "utf8")).attempts,
      1,
    );
    const retry = detectRunTransitions(observed, summary);
    assert.equal(retry.length, 1);
    let delivered = 0;
    deliverRunTransitionNotifications(retry, {
      notify: () => {},
      sendFollowUp: () => {
        delivered += 1;
      },
    });
    assert.equal(delivered, 1);
    const handled = JSON.parse(
      await readFile(join(stateDir, "terminal-handled.json"), "utf8"),
    );
    assert.equal(handled.status, "done");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability reports cancelled terminal transitions clearly", () => {
  const previous = new Map([["music", "running" as const]]);
  const transitions = detectRunTransitions(previous, {
    cancelled: 1,
    done: 0,
    exited: 0,
    failed: 0,
    killed: 0,
    running: 0,
    runningSubagents: 0,
    runs: [{ run: "music", status: "cancelled" }],
    total: 1,
  });
  assert.deepEqual(transitions, [
    { from: "running", run: "music", to: "cancelled" },
  ]);
  assert.equal(
    formatRunTransitionMessage(transitions[0]),
    "Run: `music`\nStatus: `cancelled`",
  );
  assert.equal(getRunTransitionNotificationType(transitions[0]), "info");
  assert.equal(shouldSendRunTransitionFollowUp(transitions[0]), false);
});

test("Run observability suppresses duplicate handled terminal transitions", () => {
  const failed = {
    from: "running" as const,
    run: "review",
    to: "failed" as const,
  };
  const killed = {
    from: "running" as const,
    run: "review",
    to: "killed" as const,
  };
  const done = { from: "running" as const, run: "review", to: "done" as const };
  const cancelled = {
    from: "running" as const,
    run: "review",
    to: "cancelled" as const,
  };
  assert.equal(getRunTransitionNotificationType(failed), "error");
  assert.equal(getRunTransitionNotificationType(killed), "warning");
  assert.equal(getRunTransitionNotificationType(done), "info");
  assert.equal(shouldNotifyRunTransition(failed), true);
  assert.equal(shouldNotifyRunTransition(cancelled), false);
  assert.equal(shouldNotifyRunTransition(done), true);
  assert.equal(shouldNotifyRunTransition(killed), true);
  assert.equal(shouldSendRunTransitionFollowUp(failed), true);
  assert.equal(shouldSendRunTransitionFollowUp(cancelled), false);
  assert.equal(shouldSendRunTransitionFollowUp(killed), true);
  assert.equal(shouldSendRunTransitionFollowUp(done), true);
});

test("Run observability prunes stale entries but retains terminal attention dedupe", () => {
  const statuses = new Map([
    ["/tmp/done", "done" as const],
    ["/tmp/missing", "running" as const],
    ["/tmp/live", "running" as const],
  ]);
  const lineCounts = new Map([
    ["/tmp/done", 3],
    ["/tmp/missing", 4],
    ["/tmp/live", 5],
  ]);
  const seenEventIds = new Map([
    ["/tmp/done", new Set(["done-event"])],
    ["/tmp/missing", new Set(["missing-event"])],
    ["/tmp/live", new Set(["live-event"])],
  ]);
  pruneRunObservationState(
    statuses,
    lineCounts,
    {
      cancelled: 0,
      done: 1,
      exited: 0,
      failed: 0,
      killed: 0,
      running: 1,
      runningSubagents: 1,
      runs: [
        { run: "done-run", stateDir: "/tmp/done", status: "done" },
        { run: "live-run", stateDir: "/tmp/live", status: "running" },
      ],
      total: 2,
    },
    ["/tmp/done"],
    seenEventIds,
  );
  assert.deepEqual([...statuses.keys()], ["/tmp/live"]);
  assert.deepEqual([...lineCounts.keys()], ["/tmp/done", "/tmp/live"]);
  assert.deepEqual([...seenEventIds.keys()], ["/tmp/done", "/tmp/live"]);
});

test("Run observability renders animated subagent triangles", () => {
  assert.equal(renderSubagentStatus(0), undefined);
  assert.equal(renderSubagentStatus(1, 0), "▶");
  assert.equal(renderSubagentStatus(1, 1), "▷");
  assert.equal(renderSubagentStatus(3, 0), "▶ ▷ ▷");
  assert.equal(renderSubagentStatus(3, 1), "▷ ▶ ▷");
  assert.equal(renderSubagentStatus(3, 2), "▷ ▷ ▶");
  assert.equal(renderSubagentStatus(3, 3), "▶ ▷ ▷");
});

test("Run observability counts active parallel branches", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-"));
  try {
    await writeRun(root, "alpha", "running", [], 3);
    await writeRun(root, "beta", "running", [], 2);
    await writeRun(root, "done", "done", [], 9);
    const summary = summarizeRuns(root);
    assert.equal(summary.running, 2);
    assert.equal(summary.runningSubagents, 5);
    assert.equal(renderRunStatus(summary, 1), "▷ ▶ ▷ ▷ ▷");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability caches proc descendant scans", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-"));
  try {
    await writeRun(root, "alpha", "running", [], 0);
    assert.equal(countRunningSubagents(root), countRunningSubagents(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability keeps at least one triangle per running async run", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-"));
  try {
    await writeRun(root, "alpha", "running", [], 0);
    await writeRun(root, "beta", "running", [], 2);
    await writeRun(root, "gamma", "running", [], 0);
    const summary = summarizeRuns(root);
    assert.equal(summary.running, 3);
    assert.equal(summary.runningSubagents, 4);
    assert.equal(renderRunStatus(summary, 1), "▷ ▶ ▷ ▷");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability finds opt-in retirement candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-observe-"));
  try {
    await writeRun(root, "coordinator", "running", [], 0, undefined, "children_terminal");
    await writeRun(root, "busy", "running", [], 2, undefined, "children_terminal");
    await writeRun(root, "service", "running", [], 0);
    await writeRun(root, "done", "done", [], 0, undefined, "children_terminal");
    const candidates = findRunRetirementCandidates(summarizeRuns(root));
    assert.deepEqual(candidates.map((item) => item.run), ["coordinator"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Run observability blocks retirement candidates with descendant subagents", () => {
  const candidates = findRunRetirementCandidates({
    cancelled: 0,
    done: 0,
    exited: 0,
    failed: 0,
    killed: 0,
    running: 2,
    runningSubagents: 2,
    runs: [
      {
        activeSubagents: 0,
        descendantSubagents: 1,
        retireWhen: "children_terminal",
        run: "supervisor-busy",
        stateDir: "/tmp/supervisor-busy",
        status: "running",
      },
      {
        activeSubagents: 0,
        descendantSubagents: 0,
        retireWhen: "children_terminal",
        run: "supervisor-idle",
        stateDir: "/tmp/supervisor-idle",
        status: "running",
      },
    ],
    total: 2,
  });
  assert.deepEqual(candidates, [
    {
      activeSubagents: 0,
      childRuns: 0,
      descendantSubagents: 0,
      run: "supervisor-idle",
      stateDir: "/tmp/supervisor-idle",
      terminalChildRuns: 0,
    },
  ]);
});

test("Run observability skips already handled retirement stops", () => {
  const candidates = findRunRetirementCandidates({
    cancelled: 0,
    done: 0,
    exited: 0,
    failed: 0,
    killed: 0,
    running: 1,
    runningSubagents: 1,
    runs: [
      {
        activeSubagents: 0,
        retireWhen: "children_terminal",
        run: "supervisor",
        stateDir: "/tmp/supervisor",
        status: "running",
        terminalHandled: true,
      },
    ],
    total: 1,
  });
  assert.deepEqual(candidates, []);
});

test("Run observability executes retirement through graceful stop once", async () => {
  const attempted = new Set<string>();
  const calls: string[] = [];
  const notifications: string[] = [];
  const summary = {
    cancelled: 0,
    done: 1,
    exited: 0,
    failed: 0,
    killed: 0,
    running: 1,
    runningSubagents: 1,
    runs: [
      {
        activeSubagents: 0,
        retireWhen: "children_terminal",
        run: "supervisor",
        stateDir: "/tmp/supervisor",
        status: "running" as const,
      },
      {
        run: "child-done",
        stateDir: "/tmp/supervisor/child-done",
        status: "done" as const,
      },
    ],
    total: 2,
  };
  const first = await executeRunRetirements(summary, {
    attempted,
    cancelRun: () => ({ cancelled: true }),
    notify: (message, level) => notifications.push(`${level}:${message}`),
    sendStop: async (candidate) => calls.push(candidate.run),
  });
  const second = await executeRunRetirements(summary, {
    attempted,
    cancelRun: () => ({ cancelled: true }),
    sendStop: async (candidate) => calls.push(candidate.run),
  });
  assert.deepEqual(first, [{ action: "stop", run: "supervisor", stateDir: "/tmp/supervisor" }]);
  assert.deepEqual(second, [{ action: "skip", run: "supervisor", stateDir: "/tmp/supervisor" }]);
  assert.deepEqual(calls, ["supervisor"]);
  assert.match(notifications[0], /^info:Retiring actor supervisor/);
});

test("Run observability falls back to cancellation when graceful retirement stop fails", async () => {
  const results = await executeRunRetirements(
    {
      cancelled: 0,
      done: 0,
      exited: 0,
      failed: 0,
      killed: 0,
      running: 1,
      runningSubagents: 1,
      runs: [
        {
          activeSubagents: 0,
          retireWhen: "children_terminal",
          run: "supervisor",
          stateDir: "/tmp/supervisor",
          status: "running" as const,
        },
      ],
      total: 1,
    },
    {
      cancelRun: () => ({ cancelled: true }),
      sendStop: async () => {
        throw new Error("no endpoint");
      },
    },
  );
  assert.deepEqual(results, [{ action: "cancel", run: "supervisor", stateDir: "/tmp/supervisor" }]);
});

test("Run observability blocks retirement candidates with running child async runs", () => {
  const candidates = findRunRetirementCandidates({
    cancelled: 0,
    done: 1,
    exited: 0,
    failed: 0,
    killed: 0,
    running: 2,
    runningSubagents: 2,
    runs: [
      {
        activeSubagents: 0,
        retireWhen: "children_terminal",
        run: "supervisor",
        stateDir: "/tmp/supervisor",
        status: "running",
      },
      {
        run: "child-running",
        stateDir: "/tmp/supervisor/child-running",
        status: "running",
      },
      {
        run: "child-done",
        stateDir: "/tmp/supervisor/child-done",
        status: "done",
      },
    ],
    total: 3,
  });
  assert.deepEqual(candidates, []);
  const ready = findRunRetirementCandidates({
    cancelled: 0,
    done: 2,
    exited: 0,
    failed: 0,
    killed: 0,
    running: 1,
    runningSubagents: 1,
    runs: [
      {
        activeSubagents: 0,
        retireWhen: "children_terminal",
        run: "supervisor",
        stateDir: "/tmp/supervisor",
        status: "running",
      },
      {
        run: "child-done-a",
        stateDir: "/tmp/supervisor/child-done-a",
        status: "done",
      },
      {
        run: "child-done-b",
        stateDir: "/tmp/supervisor/child-done-b",
        status: "failed",
      },
    ],
    total: 3,
  });
  assert.deepEqual(ready, [
    {
      activeSubagents: 0,
      childRuns: 2,
      descendantSubagents: 0,
      run: "supervisor",
      stateDir: "/tmp/supervisor",
      terminalChildRuns: 2,
    },
  ]);
});

test("Run observability hides status when no runs are running", () => {
  assert.equal(
    renderRunStatus({
      cancelled: 0,
      done: 3,
      exited: 1,
      failed: 0,
      killed: 0,
      running: 0,
      runningSubagents: 0,
      runs: [],
      total: 4,
    }),
    undefined,
  );
});
