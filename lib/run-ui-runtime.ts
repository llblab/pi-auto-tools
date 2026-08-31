/**
 * Ambient run observability runtime.
 * Zones: run watcher lifecycle, terminal reconciliation, status animation, shutdown teardown
 * Owns event-driven run UI coordination without owning actor execution semantics.
 */

import * as AsyncRuns from "./async-runs.ts";
import * as Limits from "./limits.ts";
import * as Observability from "./observability.ts";
import * as Paths from "./paths.ts";
import * as Pi from "./pi.ts";
import * as RunDelivery from "./run-delivery.ts";

export interface RunUiRuntime {
  close(): void;
  flushCompletionBatch(ctx: Pi.ExtensionContext): boolean;
  projectContext(messages: unknown[], ctx: Pi.ExtensionContext): unknown[];
  shutdown(
    eventReason: string,
    ownerId: string | undefined,
    ctx?: Pi.ExtensionContext,
  ): void;
  start(ctx: Pi.ExtensionContext, ownerId: string): void;
}

export interface RunUiRuntimeDeps {
  animationIntervalMs?: number;
  createRunStateWatcher?: typeof Observability.createRunStateWatcher;
  createRunTerminalReconciliationLoop?:
    typeof Observability.createRunTerminalReconciliationLoop;
  deliveryDebounceMs?: number;
  getActiveContext(): Pi.ExtensionContext | undefined;
  notificationDelayMs?: number;
  onCallbackError?: (error: unknown) => void;
  onRunEvent(): void;
  pi: Pi.ExtensionAPI;
  teardownRunsOwnedByParent?: typeof AsyncRuns.teardownRunsOwnedByParent;
}

export function createRunUiRuntime(deps: RunUiRuntimeDeps): RunUiRuntime {
  let activeContext: Pi.ExtensionContext | undefined;
  let activeOwnerId: string | undefined;
  let animationInterval: NodeJS.Timeout | undefined;
  let deliveryTimeout: NodeJS.Timeout | undefined;
  let notifyTimeout: NodeJS.Timeout | undefined;
  let recoverQueuedBatch = false;
  let recoverQueuedSteers = false;
  let running = false;
  let lastWatcherDiagnosticId = 0;
  const observation = Observability.createRunUiObservationState();
  const deliveryRecoveryDiagnostics = new Set<string>();
  const retirementAttempts = new Set<string>();
  const steerDiagnostics = new Set<string>();

  const close = (): void => {
    running = false;
    activeContext = undefined;
    activeOwnerId = undefined;
    try {
      watcher.close();
    } catch {
      /* cleanup must not escape a host callback */
    }
    try {
      reconciliation.close();
    } catch {
      /* cleanup must not escape a host callback */
    }
    if (notifyTimeout) clearTimeout(notifyTimeout);
    notifyTimeout = undefined;
    if (deliveryTimeout) clearTimeout(deliveryTimeout);
    deliveryTimeout = undefined;
    recoverQueuedBatch = false;
    recoverQueuedSteers = false;
    deliveryRecoveryDiagnostics.clear();
    steerDiagnostics.clear();
    if (animationInterval) clearInterval(animationInterval);
    animationInterval = undefined;
  };
  const stopAfterCallbackFailure = (
    label: string,
    error: unknown,
    expectedContext: Pi.ExtensionContext,
  ): void => {
    if (activeContext !== expectedContext) return;
    close();
    try {
      deps.onCallbackError?.(error);
    } catch {
      /* host callback containment must remain no-throw */
    }
    const message = error instanceof Error ? error.message : String(error);
    try {
      expectedContext.ui.notify(`Actor ${label} failed: ${message}`, "error");
    } catch {
      /* stale context or unavailable UI */
    }
  };
  const runActiveCallback = (
    label: string,
    callback: (ctx: Pi.ExtensionContext, ownerId: string) => void,
  ): void => {
    if (!running || !activeContext || !activeOwnerId) return;
    const ctx = activeContext;
    try {
      if (deps.getActiveContext() !== ctx) return;
      callback(ctx, activeOwnerId);
    } catch (error) {
      stopAfterCallbackFailure(label, error, ctx);
    }
  };
  const retireCandidateRuns = (
    ctx: Pi.ExtensionContext,
    summary: Observability.RunSummary,
  ): void => {
    void Observability.executeRunRetirements(summary, {
      attempted: retirementAttempts,
      cancelRun: (candidate) => AsyncRuns.cancelRun(candidate.stateDir),
      notify: (message, level) => ctx.ui.notify(message, level),
      sendStop: async (candidate) => AsyncRuns.cancelRun(candidate.stateDir),
    }).catch((error) =>
      stopAfterCallbackFailure("Run retirement callback", error, ctx),
    );
  };
  const journal = (ownerId: string): RunDelivery.RunDeliveryJournal =>
    RunDelivery.readRunDeliveryJournal(
      Paths.EXTENSION_RUNTIME_PATHS.tempDir,
      ownerId,
    );
  const finishPresentedBatch = (
    ownerId: string,
    batch: RunDelivery.RunCompletionBatch,
  ): boolean => {
    if (batch.phase !== "presented") return false;
    for (const member of batch.members) {
      AsyncRuns.markRunTerminalNotificationHandled(
        member.state_dir,
        member.status,
        member.run_instance_id,
      );
    }
    return RunDelivery.finalizeRunCompletionBatch({
      batchId: batch.batch_id,
      ownerId,
      tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
    });
  };
  const recoverPresentedBatch = (ownerId: string): void => {
    const batch = journal(ownerId).completion_batch;
    if (batch?.phase === "presented") finishPresentedBatch(ownerId, batch);
  };
  const finishPresentedSteer = (
    ownerId: string,
    steer: RunDelivery.RunSteerEnvelope,
  ): boolean => {
    if (steer.phase !== "presented") return false;
    AsyncRuns.markRunSteerPresentationHandled(
      steer.state_dir,
      steer.run_instance_id,
      steer.event_id,
      steer.steer_id,
    );
    return RunDelivery.finalizeRunSteer({
      ownerId,
      steerId: steer.steer_id,
      tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
    });
  };
  const recoverPresentedSteers = (ownerId: string): void => {
    for (const steer of journal(ownerId).steers) {
      if (steer.phase === "presented") finishPresentedSteer(ownerId, steer);
    }
  };
  const boundedSteerContent = (event: Observability.RunAttentionEvent): string => {
    const text = Observability.formatRunAttentionMessage(event);
    if (Buffer.byteLength(text, "utf8") <= Limits.RUN_DELIVERY_STEER_MAX_BYTES) {
      return text;
    }
    let end = Math.min(text.length, Limits.RUN_DELIVERY_STEER_MAX_BYTES - 3);
    while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") >
      Limits.RUN_DELIVERY_STEER_MAX_BYTES - 3) end -= 1;
    return `${text.slice(0, end)}…`;
  };
  const admitSteerEvents = (
    ctx: Pi.ExtensionContext,
    ownerId: string,
    events: Observability.RunAttentionEvent[],
  ): void => {
    for (const event of events.filter(Observability.isRunSteerAttentionEvent)) {
      if (!event.runInstanceId) {
        Observability.retryRunAttentionEvent(observation, event);
        const key = `${event.stateDir}:${event.id}:missing_generation`;
        if (!steerDiagnostics.has(key)) {
          steerDiagnostics.add(key);
          ctx.ui.notify(
            `Actor urgent steer ${event.id} remains retryable because its Run generation is unavailable.`,
            "warning",
          );
        }
        continue;
      }
      try {
        RunDelivery.admitRunSteerEnvelope({
          content: boundedSteerContent(event),
          eventId: event.id,
          kind: event.kind,
          level: event.level,
          occurredAt: event.ts,
          ownerId,
          run: event.run,
          runInstanceId: event.runInstanceId,
          stateDir: event.stateDir,
          tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
        });
      } catch (error) {
        Observability.retryRunAttentionEvent(observation, event);
        const message = error instanceof Error ? error.message : String(error);
        const key = `${event.stateDir}:${event.id}:${message}`;
        if (!steerDiagnostics.has(key)) {
          steerDiagnostics.add(key);
          ctx.ui.notify(
            `Actor urgent steer ${event.id} remains retryable: ${message.replaceAll(/\s+/g, " ").slice(0, 240)}`,
            "warning",
          );
        }
      }
    }
  };
  const admitCompletionTransitions = (
    ownerId: string,
    transitions: Observability.RunTransition[],
  ): boolean => {
    const existing = journal(ownerId).completion_batch;
    if (existing) return true;
    const members = Observability.collectRunCompletionBatchMembers(transitions)
      .slice(0, Limits.RUN_DELIVERY_BATCH_MAX_MEMBERS);
    if (members.length === 0) return false;
    RunDelivery.admitRunCompletionBatch({
      members,
      ownerId,
      tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
    });
    return true;
  };
  const isIdle = (ctx: Pi.ExtensionContext): boolean =>
    typeof ctx.isIdle !== "function" || ctx.isIdle();
  let flushCompletionBatch = (_ctx: Pi.ExtensionContext): boolean => false;
  const flushSteers = (ctx: Pi.ExtensionContext, ownerId: string): boolean => {
    const recovering = recoverQueuedSteers;
    for (const steer of journal(ownerId).steers) {
      if (steer.phase === "presented") {
        finishPresentedSteer(ownerId, steer);
        continue;
      }
      let phase = steer.phase;
      if (phase === "queued") {
        if (!recovering) continue;
        const evidence = Pi.inspectRunSteerSessionEvidence(ctx, {
          content: steer.content,
          eventId: steer.event_id,
          steerId: steer.steer_id,
        });
        if (evidence.status === "present") continue;
        if (evidence.status !== "absent") {
          const key = `${steer.steer_id}:${evidence.status}:${evidence.reason ?? ""}`;
          if (!steerDiagnostics.has(key)) {
            steerDiagnostics.add(key);
            ctx.ui.notify(
              `Actor urgent steer recovery is ${evidence.status}: ${evidence.reason ?? "conflicting session evidence"}. Event ${steer.event_id} remains queued.`,
              "warning",
            );
          }
          continue;
        }
        if (!RunDelivery.resetRunSteerPending({
          ownerId,
          steerId: steer.steer_id,
          tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
        })) continue;
        phase = "pending";
      }
      if (phase !== "pending") continue;
      try {
        Pi.sendRunSteer(deps.pi, {
          content: steer.content,
          eventId: steer.event_id,
          steerId: steer.steer_id,
        });
      } catch (error) {
        RunDelivery.recordRunSteerDeliveryFailure({
          error,
          ownerId,
          steerId: steer.steer_id,
          tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
        });
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `Actor urgent steer delivery failed for event ${steer.event_id}: ${message.replaceAll(/\s+/g, " ").slice(0, 240)}`,
          "error",
        );
        continue;
      }
      RunDelivery.markRunSteerQueued({
        ownerId,
        steerId: steer.steer_id,
        tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
      });
    }
    recoverQueuedSteers = false;
    return journal(ownerId).steers.length > 0;
  };
  const scheduleCompletionFlush = (): void => {
    if (!running) return;
    if (deliveryTimeout) clearTimeout(deliveryTimeout);
    deliveryTimeout = setTimeout(() => {
      deliveryTimeout = undefined;
      runActiveCallback("completion delivery callback", (ctx) => {
        flushCompletionBatch(ctx);
      });
    }, deps.deliveryDebounceMs ?? 100);
    deliveryTimeout.unref?.();
  };
  const update = (
    ctx: Pi.ExtensionContext,
    ownerId: string,
    notify = false,
    terminalOnly = false,
  ): boolean => {
    const snapshot = Observability.readRunUiSnapshot(observation, ownerId);
    ctx.ui.setStatus(
      "zz-pi-actors-runs",
      snapshot.status ? ctx.ui.theme.fg("dim", snapshot.status) : undefined,
    );
    if (!notify) return false;
    const sink = Pi.createNotificationSink(deps.pi, ctx);
    retireCandidateRuns(ctx, snapshot.summary);
    const hasCompletionCandidates =
      Observability.collectRunCompletionBatchMembers(snapshot.transitions).length > 0;
    const hasCompletionBatch = Boolean(journal(ownerId).completion_batch);
    admitSteerEvents(ctx, ownerId, snapshot.attentionEvents);
    Observability.pruneRunUiObservationState(observation, snapshot);
    if (!terminalOnly) {
      Observability.deliverRunAttentionNotifications(
        snapshot.attentionEvents.filter((event) =>
          !Observability.isRunSteerAttentionEvent(event)),
        sink,
      );
    }
    const hasSteers = flushSteers(ctx, ownerId);
    if ((hasCompletionBatch || hasCompletionCandidates) && isIdle(ctx)) {
      scheduleCompletionFlush();
    }
    return hasCompletionBatch || hasCompletionCandidates || hasSteers;
  };
  const reportDiagnostics = (ctx: Pi.ExtensionContext): void => {
    for (const diagnostic of watcher.getDiagnostics()) {
      if (diagnostic.id <= lastWatcherDiagnosticId) continue;
      lastWatcherDiagnosticId = diagnostic.id;
      ctx.ui.notify(
        diagnostic.message,
        diagnostic.code === "rearmed" ? "info" : "warning",
      );
    }
  };
  const scheduleUpdate = (): void => {
    if (!running) return;
    if (notifyTimeout) clearTimeout(notifyTimeout);
    notifyTimeout = setTimeout(() => {
      runActiveCallback("Run watcher callback", (ctx, ownerId) => {
        watcher.refresh();
        const completionDeferred = update(ctx, ownerId, true);
        if (!completionDeferred) deps.onRunEvent();
        reportDiagnostics(ctx);
      });
    }, deps.notificationDelayMs ?? 50);
    notifyTimeout.unref?.();
  };
  const watcher = (deps.createRunStateWatcher ?? Observability.createRunStateWatcher)({
    stateRoot: Paths.EXTENSION_RUNTIME_PATHS.runStateRoot,
    onChange: scheduleUpdate,
  });
  const reconciliation = (
    deps.createRunTerminalReconciliationLoop ??
    Observability.createRunTerminalReconciliationLoop
  )({
    onError: (error) => {
      if (!running || !activeContext) return;
      stopAfterCallbackFailure(
        "terminal reconciliation callback",
        error,
        activeContext,
      );
    },
    reconcile: () => {
      runActiveCallback("terminal reconciliation callback", (ctx, ownerId) => {
        update(ctx, ownerId, true);
        reportDiagnostics(ctx);
      });
    },
    refreshWatcher: () => {
      if (running) watcher.refresh();
    },
  });

  flushCompletionBatch = (ctx: Pi.ExtensionContext): boolean => {
    if (!running || activeContext !== ctx || deps.getActiveContext() !== ctx) return false;
    const ownerId = activeOwnerId;
    if (!ownerId) return false;
    if (flushSteers(ctx, ownerId)) return true;
    let batch = journal(ownerId).completion_batch;
    if (!batch) {
      const snapshot = Observability.readRunUiSnapshot(observation, ownerId);
      admitCompletionTransitions(ownerId, snapshot.transitions);
      Observability.pruneRunUiObservationState(observation, snapshot);
      batch = journal(ownerId).completion_batch;
    }
    if (!batch) return false;
    if (batch.phase === "presented") {
      finishPresentedBatch(ownerId, batch);
      const snapshot = Observability.readRunUiSnapshot(observation, ownerId);
      admitCompletionTransitions(ownerId, snapshot.transitions);
      Observability.pruneRunUiObservationState(observation, snapshot);
      batch = journal(ownerId).completion_batch;
      if (!batch) return false;
    }
    if (!isIdle(ctx)) return true;
    const content = RunDelivery.formatRunCompletionBatchMessage(batch);
    if (batch.phase === "queued") {
      if (!recoverQueuedBatch) return true;
      recoverQueuedBatch = false;
      const evidence = Pi.inspectRunCompletionBatchSessionEvidence(
        ctx,
        batch.batch_id,
        content,
      );
      if (evidence.status === "present") return true;
      if (evidence.status !== "absent") {
        const diagnosticKey = `${batch.batch_id}:${evidence.status}:${evidence.reason ?? ""}`;
        if (!deliveryRecoveryDiagnostics.has(diagnosticKey)) {
          deliveryRecoveryDiagnostics.add(diagnosticKey);
          ctx.ui.notify(
            `Actor completion recovery is ${evidence.status}: ${evidence.reason ?? "conflicting session evidence"}. Batch ${batch.batch_id} remains queued.`,
            "warning",
          );
        }
        return true;
      }
      if (!RunDelivery.resetRunCompletionBatchPending({
        batchId: batch.batch_id,
        ownerId,
        tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
      })) return true;
      batch = journal(ownerId).completion_batch!;
    }
    if (!isIdle(ctx)) return true;
    try {
      Pi.sendRunCompletionBatch(deps.pi, batch.batch_id, content);
    } catch (error) {
      RunDelivery.recordRunCompletionBatchDeliveryFailure({
        batchId: batch.batch_id,
        error,
        ownerId,
        tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
      });
      throw error;
    }
    if (!RunDelivery.markRunCompletionBatchQueued({
      batchId: batch.batch_id,
      ownerId,
      tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
    })) {
      throw new Error("Completion batch changed before queue acknowledgment");
    }
    recoverQueuedBatch = false;
    return true;
  };

  return {
    close,
    flushCompletionBatch,
    projectContext(messages, ctx) {
      if (!running || activeContext !== ctx || deps.getActiveContext() !== ctx) {
        return messages;
      }
      const ownerId = activeOwnerId;
      if (!ownerId) return messages;
      const steerContext = Pi.dedupeRunSteerContext(messages);
      let contextMessages = steerContext.messages;
      for (const steer of journal(ownerId).steers) {
        const presented = steerContext.steers.get(steer.steer_id);
        if (
          !presented ||
          presented.eventId !== steer.event_id ||
          presented.content !== steer.content
        ) {
          contextMessages = Pi.removeRunSteerFromContext(
            contextMessages,
            steer.steer_id,
          );
          continue;
        }
        if (!RunDelivery.markRunSteerQueued({
          ownerId,
          steerId: steer.steer_id,
          tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
        })) continue;
        if (!RunDelivery.markRunSteerPresented({
          ownerId,
          steerId: steer.steer_id,
          tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
        })) continue;
        const durable = journal(ownerId).steers.find((item) =>
          item.steer_id === steer.steer_id);
        if (durable) finishPresentedSteer(ownerId, durable);
      }
      const projected = Pi.dedupeRunCompletionBatchContext(contextMessages);
      const batch = journal(ownerId).completion_batch;
      if (!batch) return projected.messages;
      const content = projected.batches.get(batch.batch_id);
      if (content !== RunDelivery.formatRunCompletionBatchMessage(batch)) {
        return Pi.removeRunCompletionBatchFromContext(
          projected.messages,
          batch.batch_id,
        );
      }
      if (!RunDelivery.markRunCompletionBatchQueued({
        batchId: batch.batch_id,
        ownerId,
        tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
      })) return projected.messages;
      if (!RunDelivery.markRunCompletionBatchPresented({
        batchId: batch.batch_id,
        ownerId,
        tempDir: Paths.EXTENSION_RUNTIME_PATHS.tempDir,
      })) return projected.messages;
      const presented = journal(ownerId).completion_batch;
      if (presented) finishPresentedBatch(ownerId, presented);
      return projected.messages;
    },
    shutdown(eventReason, ownerId, ctx) {
      if (!ownerId) return;
      const teardown = (
        deps.teardownRunsOwnedByParent ?? AsyncRuns.teardownRunsOwnedByParent
      )(
        ownerId,
        Paths.EXTENSION_RUNTIME_PATHS.runStateRoot,
        { trigger: `session_shutdown:${eventReason}` },
      );
      if (teardown.failed === 0 || !ctx) return;
      try {
        ctx.ui.notify(
          `Actor shutdown teardown: killed=${teardown.killed} failed=${teardown.failed} skipped=${teardown.skipped} discovery_failed=${teardown.discoveryFailed}. Summary: ${teardown.summaryPath ?? "unavailable"}.`,
          "warning",
        );
      } catch {
        /* stale shutdown context */
      }
    },
    start(ctx, ownerId) {
      close();
      activeContext = ctx;
      activeOwnerId = ownerId;
      recoverQueuedBatch = true;
      recoverQueuedSteers = true;
      running = true;
      try {
        recoverPresentedBatch(ownerId);
        recoverPresentedSteers(ownerId);
        Observability.primeRunAttentionState(observation, ownerId);
        update(ctx, ownerId, true, true);
        watcher.refresh();
        reconciliation.start();
        animationInterval = setInterval(() => {
          runActiveCallback("status animation callback", (current, currentOwnerId) =>
            update(current, currentOwnerId),
          );
        }, deps.animationIntervalMs ?? 1000);
        animationInterval.unref?.();
      } catch (error) {
        close();
        throw error;
      }
    },
  };
}
