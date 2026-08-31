import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const agentDir = await mkdtemp(join(tmpdir(), "pi-actors-run-ui-runtime-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousAutomaticReview = process.env.PI_ACTORS_AUTOMATIC_REVIEW;
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_ACTORS_AUTOMATIC_REVIEW = "off";

const { createActorExtensionRuntime } = await import("../lib/extension-runtime.ts");
const { createRunUiRuntime } = await import("../lib/run-ui-runtime.ts");
const { readRunDeliveryJournal } = await import("../lib/run-delivery.ts");
const { appendRunTraceEvent, readRunTraceEvents } = await import("../lib/runs-trace.ts");

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousAutomaticReview === undefined) {
    delete process.env.PI_ACTORS_AUTOMATIC_REVIEW;
  } else {
    process.env.PI_ACTORS_AUTOMATIC_REVIEW = previousAutomaticReview;
  }
  await rm(agentDir, { force: true, recursive: true });
});

function staleContext(sessionId = "session-a") {
  let stale = false;
  let statusCalls = 0;
  let sessionLeaf: Record<string, unknown> | undefined;
  const sessionEntries = new Map<string, Record<string, unknown>>();
  const ui = {
    notify: () => undefined,
    setStatus: () => {
      statusCalls += 1;
    },
    setWidget: () => undefined,
    theme: { fg: (_tone: string, value: string) => value },
  };
  const sessionManager = {
    getEntry: (id: string) => sessionEntries.get(id),
    getLeafEntry: () => sessionLeaf,
    getSessionId: () => sessionId,
  };
  const context = {
    cwd: agentDir,
    get sessionManager() {
      if (stale) throw new Error("stale sessionManager");
      return sessionManager;
    },
    get ui() {
      if (stale) throw new Error("stale ui");
      return ui;
    },
  } as any;
  return {
    context,
    makeStale: () => {
      stale = true;
    },
    setSessionBranch: (entries: Record<string, unknown>[]) => {
      sessionEntries.clear();
      for (const entry of entries) sessionEntries.set(String(entry.id), entry);
      sessionLeaf = entries.at(-1);
    },
    statusCalls: () => statusCalls,
  };
}

function runtimeHarness(options: {
  animationIntervalMs?: number;
  deliveryDebounceMs?: number;
  notificationDelayMs?: number;
  sendFailures?: number;
  teardownFailed?: boolean;
} = {}) {
  let activeContext: any;
  let callbackErrors = 0;
  let watcherCloseCalls = 0;
  let watcherOnChange: (() => void) | undefined;
  let reconciliationInput: any;
  let sendAttempts = 0;
  const sentMessages: Array<{ message: any; options: any }> = [];
  let teardownInput: { ownerId?: string; trigger?: string } = {};
  const runtime = createRunUiRuntime({
    animationIntervalMs: options.animationIntervalMs ?? 10_000,
    createRunStateWatcher: ((input: any) => {
      watcherOnChange = input.onChange;
      return {
        close: () => {
          watcherCloseCalls += 1;
        },
        getDiagnostics: () => [],
        refresh: () => undefined,
      };
    }) as any,
    createRunTerminalReconciliationLoop: ((input: any) => {
      reconciliationInput = input;
      return {
        close: () => undefined,
        reconcileNow: () => {
          try {
            input.refreshWatcher();
            input.reconcile();
          } catch (error) {
            input.onError?.(error);
          }
        },
        start: () => undefined,
      };
    }) as any,
    deliveryDebounceMs: options.deliveryDebounceMs ?? 5,
    getActiveContext: () => activeContext,
    notificationDelayMs: options.notificationDelayMs ?? 5,
    onCallbackError: () => {
      callbackErrors += 1;
    },
    onRunEvent: () => undefined,
    pi: {
      sendMessage: (message: any, sendOptions: any) => {
        sendAttempts += 1;
        if (sendAttempts <= (options.sendFailures ?? 0)) {
          throw new Error("simulated completion send failure");
        }
        sentMessages.push({ message, options: sendOptions });
      },
    } as any,
    teardownRunsOwnedByParent: ((ownerId: string, _root: string, input: any) => {
      teardownInput = { ownerId, trigger: input.trigger };
      return {
        attempted: 0,
        attempts: [],
        discoveryFailed: 0,
        discoveryFailures: [],
        failed: options.teardownFailed ? 1 : 0,
        killed: 0,
        skipped: 0,
      };
    }) as any,
  });
  return {
    callbackErrors: () => callbackErrors,
    reconciliationInput: () => reconciliationInput,
    runtime,
    sendAttempts: () => sendAttempts,
    sentMessages: () => sentMessages,
    setActiveContext: (ctx: any) => {
      activeContext = ctx;
    },
    teardownInput: () => teardownInput,
    watcherCloseCalls: () => watcherCloseCalls,
    watcherOnChange: () => watcherOnChange,
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const extensionTempDir = join(agentDir, "tmp", "pi-actors");

async function writeTerminalRun(
  ownerId: string,
  run: string,
  runInstanceId: string,
): Promise<string> {
  const stateDir = join(extensionTempDir, "runs", run);
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, "run.json"), JSON.stringify({
    createdAt: "2026-09-01T12:00:00.000Z",
    cwd: agentDir,
    ownerId,
    pid: 999_999_999,
    run,
    run_instance_id: runInstanceId,
    state_dir: stateDir,
  }));
  await writeFile(join(stateDir, "progress.json"), JSON.stringify({
    completed: 1,
    failures: [],
    updatedAt: "2026-09-01T12:01:00.000Z",
  }));
  await writeFile(join(stateDir, "result.json"), JSON.stringify({
    code: 0,
    completed_at: "2026-09-01T12:01:00.000Z",
  }));
  await rm(join(stateDir, "terminal-handled.json"), { force: true });
  return stateDir;
}

test("stale animation ticks stop the Run UI runtime without escaping", async () => {
  const stale = staleContext();
  const harness = runtimeHarness({ animationIntervalMs: 5 });
  harness.setActiveContext(stale.context);
  harness.runtime.start(stale.context, "session-a");
  assert.equal(stale.statusCalls(), 1);

  stale.makeStale();
  await delay(25);
  const callsAfterFailure = stale.statusCalls();
  await delay(15);

  assert.equal(callsAfterFailure, 1);
  assert.equal(stale.statusCalls(), 1);
  assert.equal(harness.watcherCloseCalls() >= 2, true);
  assert.equal(harness.callbackErrors(), 1);
  harness.runtime.close();
});

test("stale delayed watcher updates and reconciliation callbacks fail closed", async () => {
  const watcherStale = staleContext();
  const watcherHarness = runtimeHarness({ notificationDelayMs: 5 });
  watcherHarness.setActiveContext(watcherStale.context);
  watcherHarness.runtime.start(watcherStale.context, "session-a");
  watcherHarness.watcherOnChange()!();
  watcherStale.makeStale();
  await delay(20);
  assert.equal(watcherHarness.watcherCloseCalls() >= 2, true);

  const reconciliationStale = staleContext();
  const reconciliationHarness = runtimeHarness();
  reconciliationHarness.setActiveContext(reconciliationStale.context);
  reconciliationHarness.runtime.start(reconciliationStale.context, "session-a");
  reconciliationStale.makeStale();
  assert.doesNotThrow(() =>
    reconciliationHarness.reconciliationInput().onError(
      new Error("reconciliation failed"),
    ),
  );
  assert.equal(reconciliationHarness.watcherCloseCalls() >= 2, true);
  reconciliationHarness.runtime.close();
});

test("shutdown uses captured owner identity and stale UI notification is no-throw", () => {
  const stale = staleContext();
  const harness = runtimeHarness({ teardownFailed: true });
  harness.setActiveContext(stale.context);
  harness.runtime.start(stale.context, "session-a");
  stale.makeStale();

  assert.doesNotThrow(() =>
    harness.runtime.shutdown("quit", "session-a", stale.context),
  );
  assert.deepEqual(harness.teardownInput(), {
    ownerId: "session-a",
    trigger: "session_shutdown:quit",
  });
  assert.doesNotThrow(() => harness.runtime.close());
});

test("completion batches wait for idle and acknowledge exact presented generations", async () => {
  const ownerId = "session-batch";
  const firstDir = await writeTerminalRun(ownerId, "batch-first", "generation-first");
  const secondDir = await writeTerminalRun(ownerId, "batch-second", "generation-second");
  await writeFile(
    join(firstDir, "terminal-delivery-failure.json"),
    JSON.stringify({ attempts: 1, error: "legacy transport failure" }),
  );
  const active = staleContext(ownerId);
  let idle = false;
  (active.context as any).isIdle = () => idle;
  const harness = runtimeHarness({ deliveryDebounceMs: 5 });
  harness.setActiveContext(active.context);
  harness.runtime.start(active.context, ownerId);
  harness.watcherOnChange()!();
  await delay(20);

  assert.equal(harness.sentMessages().length, 0);
  assert.equal(
    readRunDeliveryJournal(extensionTempDir, ownerId).completion_batch,
    undefined,
  );

  idle = true;
  assert.equal(harness.runtime.flushCompletionBatch(active.context), true);
  assert.equal(harness.sentMessages().length, 1);
  const firstMessage = harness.sentMessages()[0]!.message;
  assert.equal(firstMessage.customType, "pi-actors-run-batch");
  assert.match(firstMessage.content, /Actor completions: 2/);
  assert.deepEqual(harness.sentMessages()[0]!.options, {
    deliverAs: "followUp",
    triggerTurn: true,
  });
  await assert.rejects(readFile(join(firstDir, "terminal-handled.json")), /ENOENT/);

  await writeTerminalRun(ownerId, "batch-second", "generation-second-replacement");
  assert.equal(
    harness.runtime.projectContext([firstMessage, firstMessage], active.context).length,
    1,
  );
  const firstHandled = JSON.parse(
    await readFile(join(firstDir, "terminal-handled.json"), "utf8"),
  );
  assert.equal(firstHandled.run_instance_id, "generation-first");
  await assert.rejects(
    readFile(join(firstDir, "terminal-delivery-failure.json")),
    /ENOENT/,
  );
  await assert.rejects(readFile(join(secondDir, "terminal-handled.json")), /ENOENT/);

  assert.equal(harness.runtime.flushCompletionBatch(active.context), true);
  assert.equal(harness.sentMessages().length, 2);
  const replacementMessage = harness.sentMessages()[1]!.message;
  assert.match(replacementMessage.content, /Actor completions: 1/);
  assert.match(replacementMessage.content, /batch-second/);
  harness.runtime.projectContext([replacementMessage], active.context);
  const replacementHandled = JSON.parse(
    await readFile(join(secondDir, "terminal-handled.json"), "utf8"),
  );
  assert.equal(
    replacementHandled.run_instance_id,
    "generation-second-replacement",
  );
  assert.equal(readRunDeliveryJournal(extensionTempDir, ownerId).receipts.length, 2);
  harness.runtime.close();
});

test("idle completion debounce snapshots one immutable completion epoch", async () => {
  const ownerId = "session-idle-epoch";
  const active = staleContext(ownerId);
  (active.context as any).isIdle = () => true;
  const harness = runtimeHarness({ deliveryDebounceMs: 500, notificationDelayMs: 1 });
  harness.setActiveContext(active.context);
  harness.runtime.start(active.context, ownerId);

  await writeTerminalRun(ownerId, "idle-first", "generation-idle-first");
  harness.watcherOnChange()!();
  await delay(5);
  await writeTerminalRun(ownerId, "idle-second", "generation-idle-second");
  harness.watcherOnChange()!();
  await delay(600);

  assert.equal(harness.sentMessages().length, 1);
  assert.match(harness.sentMessages()[0]!.message.content, /Actor completions: 2/);
  harness.runtime.projectContext(
    [harness.sentMessages()[0]!.message],
    active.context,
  );
  harness.runtime.close();
});

test("queued completion batches recover with one stable batch id", async () => {
  const ownerId = "session-recovery";
  const stateDir = await writeTerminalRun(ownerId, "batch-recovery", "generation-recovery");
  const active = staleContext(ownerId);
  (active.context as any).isIdle = () => true;
  const first = runtimeHarness({ deliveryDebounceMs: 5 });
  first.setActiveContext(active.context);
  first.runtime.start(active.context, ownerId);
  first.watcherOnChange()!();
  await delay(20);
  assert.equal(first.sentMessages().length, 1);
  const batchId = first.sentMessages()[0]!.message.details
    .pi_actors_delivery.batch_id;
  assert.equal(
    readRunDeliveryJournal(extensionTempDir, ownerId).completion_batch?.phase,
    "queued",
  );
  first.runtime.close();

  const recovered = runtimeHarness({ deliveryDebounceMs: 5 });
  recovered.setActiveContext(active.context);
  recovered.runtime.start(active.context, ownerId);
  await delay(20);
  assert.equal(recovered.sentMessages().length, 1);
  assert.equal(
    recovered.sentMessages()[0]!.message.details.pi_actors_delivery.batch_id,
    batchId,
  );
  recovered.runtime.projectContext(
    [recovered.sentMessages()[0]!.message],
    active.context,
  );
  assert.equal(
    JSON.parse(await readFile(join(stateDir, "terminal-handled.json"), "utf8"))
      .run_instance_id,
    "generation-recovery",
  );
  assert.equal(
    readRunDeliveryJournal(extensionTempDir, ownerId).completion_batch,
    undefined,
  );
  recovered.runtime.close();
});

test("queued completion recovery waits when exact owned session evidence exists", async () => {
  const ownerId = "session-recovery-present";
  const stateDir = await writeTerminalRun(
    ownerId,
    "batch-recovery-present",
    "generation-recovery-present",
  );
  const active = staleContext(ownerId);
  (active.context as any).isIdle = () => true;
  const first = runtimeHarness({ deliveryDebounceMs: 5 });
  first.setActiveContext(active.context);
  first.runtime.start(active.context, ownerId);
  await delay(20);
  const exact = first.sentMessages()[0]!.message;
  first.runtime.close();

  active.setSessionBranch([{
    ...exact,
    id: "session-batch-entry",
    parentId: null,
    type: "custom_message",
  }]);
  const recovered = runtimeHarness({ deliveryDebounceMs: 5 });
  recovered.setActiveContext(active.context);
  recovered.runtime.start(active.context, ownerId);
  await delay(20);
  assert.equal(recovered.sentMessages().length, 0);
  assert.equal(
    readRunDeliveryJournal(extensionTempDir, ownerId).completion_batch?.phase,
    "queued",
  );
  recovered.runtime.projectContext([exact], active.context);
  assert.equal(
    JSON.parse(await readFile(join(stateDir, "terminal-handled.json"), "utf8"))
      .run_instance_id,
    "generation-recovery-present",
  );
  recovered.runtime.close();
});

test("pending completion send failures remain durable and retryable", async () => {
  const ownerId = "session-send-failure";
  const stateDir = await writeTerminalRun(
    ownerId,
    "batch-send-failure",
    "generation-send-failure",
  );
  const active = staleContext(ownerId);
  (active.context as any).isIdle = () => true;
  const failing = runtimeHarness({ deliveryDebounceMs: 5, sendFailures: 1 });
  failing.setActiveContext(active.context);
  failing.runtime.start(active.context, ownerId);
  await delay(20);
  assert.equal(failing.sendAttempts(), 1);
  assert.equal(failing.callbackErrors(), 1);
  const pending = readRunDeliveryJournal(extensionTempDir, ownerId).completion_batch;
  assert.equal(pending?.phase, "pending");
  assert.equal(pending?.attempts, 1);
  assert.match(pending?.last_error ?? "", /simulated completion send failure/);
  await assert.rejects(readFile(join(stateDir, "terminal-handled.json")), /ENOENT/);

  const retry = runtimeHarness({ deliveryDebounceMs: 5 });
  retry.setActiveContext(active.context);
  retry.runtime.start(active.context, ownerId);
  await delay(20);
  assert.equal(retry.sentMessages().length, 1);
  retry.runtime.projectContext([retry.sentMessages()[0]!.message], active.context);
  assert.equal(
    JSON.parse(await readFile(join(stateDir, "terminal-handled.json"), "utf8"))
      .run_instance_id,
    "generation-send-failure",
  );
  retry.runtime.close();
});

test("explicit urgent steer reaches Pi before the eventual terminal batch", async () => {
  const ownerId = "session-urgent-steer";
  const stateDir = await writeTerminalRun(
    ownerId,
    "urgent-steer",
    "generation-urgent-steer",
  );
  const event = appendRunTraceEvent(stateDir, {
    attention: "steer",
    kind: "checkpoint.blocked",
    level: "warning",
    summary: "Approval required before migration",
  });
  const active = staleContext(ownerId);
  (active.context as any).isIdle = () => true;
  const harness = runtimeHarness({ deliveryDebounceMs: 5 });
  harness.setActiveContext(active.context);
  harness.runtime.start(active.context, ownerId);

  assert.equal(harness.sentMessages().length, 1);
  const steerMessage = harness.sentMessages()[0]!.message;
  assert.equal(steerMessage.customType, "pi-actors-run-steer");
  assert.equal(steerMessage.details.pi_actors_delivery.event_id, event.id);
  assert.deepEqual(harness.sentMessages()[0]!.options, {
    deliverAs: "steer",
    triggerTurn: true,
  });
  assert.equal(
    readRunDeliveryJournal(extensionTempDir, ownerId).steers[0]?.phase,
    "queued",
  );
  harness.runtime.projectContext([steerMessage, steerMessage], active.context);
  assert.equal(readRunDeliveryJournal(extensionTempDir, ownerId).steers.length, 0);
  assert.equal(
    readRunTraceEvents(stateDir).some((item: any) =>
      item.kind === "delivery.steer_presented" && item.data?.event_id === event.id),
    true,
  );
  await assert.rejects(readFile(join(stateDir, "terminal-handled.json")), /ENOENT/);

  assert.equal(harness.runtime.flushCompletionBatch(active.context), true);
  assert.equal(harness.sentMessages().length, 2);
  const completionMessage = harness.sentMessages()[1]!.message;
  assert.equal(completionMessage.customType, "pi-actors-run-batch");
  harness.runtime.projectContext([completionMessage], active.context);
  assert.equal(
    JSON.parse(await readFile(join(stateDir, "terminal-handled.json"), "utf8"))
      .run_instance_id,
    "generation-urgent-steer",
  );
  assert.deepEqual(
    readRunDeliveryJournal(extensionTempDir, ownerId).receipts.map((item: any) =>
      item.kind),
    ["urgent_steer", "completion_batch"],
  );
  harness.runtime.close();
});

test("urgent steer send failure remains durable without stopping observation", async () => {
  const ownerId = "session-steer-failure";
  const stateDir = await writeTerminalRun(
    ownerId,
    "steer-failure",
    "generation-steer-failure",
  );
  appendRunTraceEvent(stateDir, {
    attention: "steer",
    kind: "checkpoint.blocked",
    summary: "Retry this steer",
  });
  const active = staleContext(ownerId);
  (active.context as any).isIdle = () => true;
  const harness = runtimeHarness({ deliveryDebounceMs: 5, sendFailures: 1 });
  harness.setActiveContext(active.context);
  harness.runtime.start(active.context, ownerId);
  await delay(20);

  assert.equal(harness.callbackErrors(), 0);
  assert.equal(harness.sendAttempts(), 2);
  assert.equal(harness.sentMessages().length, 1);
  const steer = readRunDeliveryJournal(extensionTempDir, ownerId).steers[0];
  assert.equal(steer?.phase, "queued");
  assert.equal(steer?.attempts, 1);
  assert.match(steer?.last_error ?? "", /simulated completion send failure/);
  harness.runtime.projectContext([harness.sentMessages()[0]!.message], active.context);
  harness.runtime.close();
});

test("queued urgent steer waits on exact owned session evidence", async () => {
  const ownerId = "session-steer-recovery";
  const stateDir = await writeTerminalRun(
    ownerId,
    "steer-recovery",
    "generation-steer-recovery",
  );
  appendRunTraceEvent(stateDir, {
    attention: "steer",
    kind: "checkpoint.blocked",
    summary: "Recover this steer",
  });
  const active = staleContext(ownerId);
  (active.context as any).isIdle = () => true;
  const first = runtimeHarness({ deliveryDebounceMs: 5 });
  first.setActiveContext(active.context);
  first.runtime.start(active.context, ownerId);
  const exact = first.sentMessages()[0]!.message;
  first.runtime.close();

  active.setSessionBranch([{
    ...exact,
    id: "session-steer-entry",
    parentId: null,
    type: "custom_message",
  }]);
  const recovered = runtimeHarness({ deliveryDebounceMs: 5 });
  recovered.setActiveContext(active.context);
  recovered.runtime.start(active.context, ownerId);
  await delay(20);
  assert.equal(recovered.sentMessages().length, 0);
  assert.equal(
    readRunDeliveryJournal(extensionTempDir, ownerId).steers[0]?.phase,
    "queued",
  );
  recovered.runtime.projectContext([exact], active.context);
  assert.equal(readRunDeliveryJournal(extensionTempDir, ownerId).steers.length, 0);
  recovered.runtime.close();
});

test("completion context rejects conflicting or altered batch content", async () => {
  const ownerId = "session-context-fence";
  await writeTerminalRun(ownerId, "batch-context", "generation-context");
  const active = staleContext(ownerId);
  (active.context as any).isIdle = () => true;
  const harness = runtimeHarness({ deliveryDebounceMs: 5 });
  harness.setActiveContext(active.context);
  harness.runtime.start(active.context, ownerId);
  harness.watcherOnChange()!();
  await delay(20);
  const exact = harness.sentMessages()[0]!.message;
  const altered = { ...exact, content: `${exact.content}\naltered` };
  assert.deepEqual(harness.runtime.projectContext([altered], active.context), []);
  assert.equal(
    readRunDeliveryJournal(extensionTempDir, ownerId).completion_batch?.phase,
    "queued",
  );
  assert.deepEqual(
    harness.runtime.projectContext([exact, altered], active.context),
    [],
  );
  assert.equal(
    readRunDeliveryJournal(extensionTempDir, ownerId).completion_batch?.phase,
    "queued",
  );
  harness.runtime.projectContext([exact, exact], active.context);
  assert.equal(
    readRunDeliveryJournal(extensionTempDir, ownerId).completion_batch,
    undefined,
  );
  harness.runtime.close();
});

test("agent settled flush closes a missed-watcher completion race", {
  skip: process.platform === "win32"
    ? "Node's Windows fs watcher asserts when its watched directory is removed"
    : false,
}, async () => {
  const ownerId = "session-settled-race";
  const definitions = new Map<string, any>();
  const sent: any[] = [];
  const extension = createActorExtensionRuntime({
    getActiveTools: () => [...definitions.keys()],
    getAllTools: () => [...definitions.values()],
    getThinkingLevel: () => "off",
    registerTool: (definition: any) => definitions.set(definition.name, definition),
    sendMessage: (message: any, options: any) => sent.push({ message, options }),
    setActiveTools: () => undefined,
  } as never);
  const active = staleContext(ownerId);
  (active.context as any).isIdle = () => true;
  await extension.onSessionStart(active.context);
  const stateDir = await writeTerminalRun(
    ownerId,
    "settled-race",
    "generation-settled-race",
  );

  extension.onAgentSettled(active.context);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message.content, /settled-race/);
  extension.onContext([sent[0].message], active.context);
  assert.equal(
    JSON.parse(await readFile(join(stateDir, "terminal-handled.json"), "utf8"))
      .run_instance_id,
    "generation-settled-race",
  );
  extension.onAgentSettled(active.context);
  assert.equal(sent.length, 1);
  extension.onSessionShutdown("quit", active.context);
});

test("a delayed old-session shutdown cannot close the replacement runtime", async () => {
  const definitions = new Map<string, any>();
  const extension = createActorExtensionRuntime({
    getActiveTools: () => [...definitions.keys()],
    getAllTools: () => [...definitions.values()],
    getThinkingLevel: () => "off",
    registerTool: (definition: any) => definitions.set(definition.name, definition),
    sendMessage: () => undefined,
    setActiveTools: () => undefined,
  } as never);
  const alpha = staleContext("session-alpha");
  const beta = staleContext("session-beta");
  await extension.onSessionStart(alpha.context);
  await extension.onSessionStart(beta.context);
  const betaStatusCalls = beta.statusCalls();
  alpha.makeStale();

  assert.doesNotThrow(() => extension.onSessionShutdown("quit", alpha.context));
  await delay(1_050);
  assert.equal(beta.statusCalls() > betaStatusCalls, true);
  extension.onSessionShutdown("quit", beta.context);
});

test("extension shutdown never re-reads an invalidated context", async () => {
  const definitions = new Map<string, any>();
  const extension = createActorExtensionRuntime({
    getActiveTools: () => [...definitions.keys()],
    getAllTools: () => [...definitions.values()],
    getThinkingLevel: () => "off",
    registerTool: (definition: any) => definitions.set(definition.name, definition),
    sendMessage: () => undefined,
    setActiveTools: () => undefined,
  } as never);
  const stale = staleContext();
  await extension.onSessionStart(stale.context);
  stale.makeStale();

  assert.doesNotThrow(() => extension.onSessionShutdown("quit", stale.context));
});
