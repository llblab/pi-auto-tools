/**
 * Pi SDK adapter boundary.
 * Zones: pi agent sdk boundary, extension host adapters
 * Owns direct pi SDK imports and exposes narrow pi-actors-facing helpers/types for the composition root.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import * as SessionEvidence from "./session-evidence.ts";

export type { ExtensionAPI, ExtensionContext };

export const RUN_COMPLETION_BATCH_CUSTOM_TYPE = "pi-actors-run-batch";
export const RUN_STEER_CUSTOM_TYPE = "pi-actors-run-steer";

export interface PiNotificationSink {
  notify(message: string, level: "info" | "warning" | "error"): void;
  sendFollowUp(message: {
    customType: string;
    content: string;
    display: false;
    details: unknown;
  }): void;
}

export function getSessionId(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

export function createNotificationSink(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): PiNotificationSink {
  return {
    notify: (message, level) => ctx.ui.notify(message, level),
    sendFollowUp: (message) =>
      pi.sendMessage(message, {
        deliverAs: "followUp",
        triggerTurn: true,
      }),
  };
}

export function sendRunCompletionBatch(
  pi: ExtensionAPI,
  batchId: string,
  content: string,
): void {
  pi.sendMessage({
    customType: RUN_COMPLETION_BATCH_CUSTOM_TYPE,
    content,
    display: false,
    details: {
      pi_actors_delivery: {
        batch_id: batchId,
        kind: "completion_batch",
      },
    },
  }, {
    deliverAs: "followUp",
    triggerTurn: true,
  });
}

export function sendRunSteer(
  pi: ExtensionAPI,
  input: { content: string; eventId: string; steerId: string },
): void {
  pi.sendMessage({
    customType: RUN_STEER_CUSTOM_TYPE,
    content: input.content,
    display: false,
    details: {
      pi_actors_delivery: {
        event_id: input.eventId,
        kind: "urgent_steer",
        steer_id: input.steerId,
      },
    },
  }, {
    deliverAs: "steer",
    triggerTurn: true,
  });
}

function completionBatchMessage(
  message: unknown,
): { batchId: string; content: string } | undefined {
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const record = message as Record<string, unknown>;
  if (
    record.customType !== RUN_COMPLETION_BATCH_CUSTOM_TYPE ||
    typeof record.content !== "string"
  ) return undefined;
  const details = record.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const delivery = (details as Record<string, unknown>).pi_actors_delivery;
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) return undefined;
  const envelope = delivery as Record<string, unknown>;
  if (
    envelope.kind !== "completion_batch" ||
    typeof envelope.batch_id !== "string" ||
    !envelope.batch_id ||
    envelope.batch_id.length > 128
  ) return undefined;
  return { batchId: envelope.batch_id, content: record.content };
}

/** Collapse exact retry duplicates and remove conflicting delivery envelopes. */
export function dedupeRunCompletionBatchContext(messages: unknown[]): {
  batches: Map<string, string>;
  conflicts: Set<string>;
  messages: unknown[];
} {
  const batches = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const message of messages) {
    const batch = completionBatchMessage(message);
    if (!batch) continue;
    const existing = batches.get(batch.batchId);
    if (existing !== undefined && existing !== batch.content) {
      conflicts.add(batch.batchId);
    } else if (existing === undefined) {
      batches.set(batch.batchId, batch.content);
    }
  }
  const retained = new Set<string>();
  const filtered = messages.filter((message) => {
    const batch = completionBatchMessage(message);
    if (!batch) return true;
    if (conflicts.has(batch.batchId) || retained.has(batch.batchId)) return false;
    retained.add(batch.batchId);
    return true;
  });
  for (const batchId of conflicts) batches.delete(batchId);
  return { batches, conflicts, messages: filtered };
}

export function removeRunCompletionBatchFromContext(
  messages: unknown[],
  batchId: string,
): unknown[] {
  return messages.filter((message) =>
    completionBatchMessage(message)?.batchId !== batchId);
}

function steerMessage(
  message: unknown,
): { content: string; eventId: string; steerId: string } | undefined {
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const record = message as Record<string, unknown>;
  if (record.customType !== RUN_STEER_CUSTOM_TYPE || typeof record.content !== "string") {
    return undefined;
  }
  const details = record.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const delivery = (details as Record<string, unknown>).pi_actors_delivery;
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) return undefined;
  const envelope = delivery as Record<string, unknown>;
  if (
    envelope.kind !== "urgent_steer" ||
    typeof envelope.steer_id !== "string" ||
    !envelope.steer_id ||
    envelope.steer_id.length > 128 ||
    typeof envelope.event_id !== "string" ||
    !envelope.event_id ||
    envelope.event_id.length > 256
  ) return undefined;
  return {
    content: record.content,
    eventId: envelope.event_id,
    steerId: envelope.steer_id,
  };
}

export function dedupeRunSteerContext(messages: unknown[]): {
  conflicts: Set<string>;
  messages: unknown[];
  steers: Map<string, { content: string; eventId: string }>;
} {
  const conflicts = new Set<string>();
  const steers = new Map<string, { content: string; eventId: string }>();
  for (const message of messages) {
    const steer = steerMessage(message);
    if (!steer) continue;
    const existing = steers.get(steer.steerId);
    if (existing &&
      (existing.content !== steer.content || existing.eventId !== steer.eventId)) {
      conflicts.add(steer.steerId);
    } else if (!existing) {
      steers.set(steer.steerId, {
        content: steer.content,
        eventId: steer.eventId,
      });
    }
  }
  const retained = new Set<string>();
  const filtered = messages.filter((message) => {
    const steer = steerMessage(message);
    if (!steer) return true;
    if (conflicts.has(steer.steerId) || retained.has(steer.steerId)) return false;
    retained.add(steer.steerId);
    return true;
  });
  for (const steerId of conflicts) steers.delete(steerId);
  return { conflicts, messages: filtered, steers };
}

export function removeRunSteerFromContext(
  messages: unknown[],
  steerId: string,
): unknown[] {
  return messages.filter((message) => steerMessage(message)?.steerId !== steerId);
}

export function inspectRunSteerSessionEvidence(
  ctx: ExtensionContext,
  input: { content: string; eventId: string; steerId: string },
): SessionEvidence.ActiveSessionEntryEvidence {
  return SessionEvidence.inspectBoundedActiveSessionEntries({
    getEntry: (id) => ctx.sessionManager.getEntry(id),
    leaf: ctx.sessionManager.getLeafEntry(),
    match: (entry) => {
      const steer = steerMessage(entry);
      if (!steer || steer.steerId !== input.steerId) return undefined;
      return steer.content === input.content && steer.eventId === input.eventId
        ? "present"
        : "conflict";
    },
  });
}

export function inspectRunCompletionBatchSessionEvidence(
  ctx: ExtensionContext,
  batchId: string,
  content: string,
): SessionEvidence.ActiveSessionEntryEvidence {
  return SessionEvidence.inspectBoundedActiveSessionEntries({
    getEntry: (id) => ctx.sessionManager.getEntry(id),
    leaf: ctx.sessionManager.getLeafEntry(),
    match: (entry) => {
      const batch = completionBatchMessage(entry);
      if (!batch || batch.batchId !== batchId) return undefined;
      return batch.content === content ? "present" : "conflict";
    },
  });
}

export function registerToolDefinitions(
  pi: ExtensionAPI,
  definitions: Iterable<unknown>,
): void {
  for (const definition of definitions) pi.registerTool(definition as never);
}
