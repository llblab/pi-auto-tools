/**
 * Coordinator delivery persistence.
 * Zones: owner-scoped completion batches, delivery phase fencing, bounded receipts
 * Owns durable delivery state; excludes Run discovery, Pi scheduling, and model formatting.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { withFileMutationLock, writeTextAtomic } from "./file-state.ts";
import * as Limits from "./limits.ts";

export type RunCompletionDeliveryStatus = "done" | "failed" | "killed" | "exited";
export type RunDeliveryPhase = "pending" | "queued" | "presented";

export interface RunCompletionBatchMember {
  artifacts?: Record<string, string>;
  run: string;
  run_instance_id: string;
  state_dir: string;
  status: RunCompletionDeliveryStatus;
  summary: string;
  terminal_at: string;
}

export interface RunCompletionBatch {
  attempts?: number;
  batch_id: string;
  created_at: string;
  last_error?: string;
  last_failed_at?: string;
  members: RunCompletionBatchMember[];
  phase: RunDeliveryPhase;
  presented_at?: string;
  queued_at?: string;
}

export interface RunSteerEnvelope {
  attempts?: number;
  content: string;
  created_at: string;
  event_id: string;
  kind: string;
  last_error?: string;
  last_failed_at?: string;
  level: "info" | "warning" | "error";
  occurred_at: string;
  phase: RunDeliveryPhase;
  presented_at?: string;
  queued_at?: string;
  run: string;
  run_instance_id: string;
  state_dir: string;
  steer_id: string;
}

export interface RunDeliveryReceipt {
  delivery_id: string;
  kind: "completion_batch" | "urgent_steer";
  presented_at: string;
}

export interface RunDeliveryJournal {
  completion_batch?: RunCompletionBatch;
  owner_id: string;
  receipts: RunDeliveryReceipt[];
  schema: "run-delivery-v1";
  steers: RunSteerEnvelope[];
}

export interface AdmitRunCompletionBatchInput {
  batchId?: string;
  members: RunCompletionBatchMember[];
  now?: Date;
  ownerId: string;
  tempDir: string;
}

export interface RunDeliveryTransitionInput {
  batchId: string;
  now?: Date;
  ownerId: string;
  tempDir: string;
}

export interface AdmitRunSteerEnvelopeInput {
  content: string;
  eventId: string;
  kind: string;
  level: "info" | "warning" | "error";
  now?: Date;
  occurredAt: string;
  ownerId: string;
  run: string;
  runInstanceId: string;
  stateDir: string;
  steerId?: string;
  tempDir: string;
}

export interface RunSteerTransitionInput {
  now?: Date;
  ownerId: string;
  steerId: string;
  tempDir: string;
}

const RUN_DELIVERY_SCHEMA = "run-delivery-v1";
const MEMBER_FIELDS = new Set([
  "artifacts",
  "run",
  "run_instance_id",
  "state_dir",
  "status",
  "summary",
  "terminal_at",
]);
const BATCH_FIELDS = new Set([
  "attempts",
  "batch_id",
  "created_at",
  "last_error",
  "last_failed_at",
  "members",
  "phase",
  "presented_at",
  "queued_at",
]);
const JOURNAL_FIELDS = new Set([
  "completion_batch",
  "owner_id",
  "receipts",
  "schema",
  "steers",
]);
const RECEIPT_FIELDS = new Set([
  "delivery_id",
  "kind",
  "presented_at",
]);
const STEER_FIELDS = new Set([
  "attempts",
  "content",
  "created_at",
  "event_id",
  "kind",
  "last_error",
  "last_failed_at",
  "level",
  "occurred_at",
  "phase",
  "presented_at",
  "queued_at",
  "run",
  "run_instance_id",
  "state_dir",
  "steer_id",
]);

function assertExactFields(
  value: Record<string, unknown>,
  fields: Set<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !fields.has(key));
  if (unknown) throw new Error(`${label} has unknown field: ${unknown}`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new Error(`${label} exceeds ${maxLength} characters`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const text = boundedString(value, label, 64);
  if (Number.isNaN(Date.parse(text))) throw new Error(`${label} must be a timestamp`);
  return text;
}

function completionStatus(value: unknown): RunCompletionDeliveryStatus {
  if (value === "done" || value === "failed" || value === "killed" || value === "exited") {
    return value;
  }
  throw new Error("Completion batch member status is invalid");
}

function artifacts(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, "Completion batch member artifacts");
  const entries = Object.entries(record);
  if (entries.length > 4) throw new Error("Completion batch member has too many artifacts");
  return Object.fromEntries(entries.map(([name, path]) => [
    boundedString(name, "Completion batch artifact name", 120),
    boundedString(path, "Completion batch artifact path", 4_096),
  ]));
}

function parseMember(value: unknown): RunCompletionBatchMember {
  const record = asRecord(value, "Completion batch member");
  assertExactFields(record, MEMBER_FIELDS, "Completion batch member");
  const parsedArtifacts = artifacts(record.artifacts);
  return {
    ...(parsedArtifacts ? { artifacts: parsedArtifacts } : {}),
    run: boundedString(record.run, "Completion batch member run", 120),
    run_instance_id: boundedString(
      record.run_instance_id,
      "Completion batch member run_instance_id",
      256,
    ),
    state_dir: boundedString(record.state_dir, "Completion batch member state_dir", 4_096),
    status: completionStatus(record.status),
    summary: boundedString(record.summary, "Completion batch member summary", 1_000),
    terminal_at: timestamp(record.terminal_at, "Completion batch member terminal_at"),
  };
}

function parseBatch(value: unknown): RunCompletionBatch {
  const record = asRecord(value, "Completion batch");
  assertExactFields(record, BATCH_FIELDS, "Completion batch");
  if (!Array.isArray(record.members) || record.members.length === 0) {
    throw new Error("Completion batch members must be a non-empty array");
  }
  if (record.members.length > Limits.RUN_DELIVERY_BATCH_MAX_MEMBERS) {
    throw new Error("Completion batch exceeds the member limit");
  }
  const members = record.members.map(parseMember);
  const identities = new Set<string>();
  for (const member of members) {
    const identity = `${member.state_dir}\0${member.run_instance_id}`;
    if (identities.has(identity)) throw new Error("Completion batch has duplicate generation members");
    identities.add(identity);
  }
  const phase = record.phase;
  if (phase !== "pending" && phase !== "queued" && phase !== "presented") {
    throw new Error("Completion batch phase is invalid");
  }
  const queuedAt = record.queued_at === undefined
    ? undefined
    : timestamp(record.queued_at, "Completion batch queued_at");
  const presentedAt = record.presented_at === undefined
    ? undefined
    : timestamp(record.presented_at, "Completion batch presented_at");
  const attempts = record.attempts;
  if (
    attempts !== undefined &&
    (typeof attempts !== "number" ||
      !Number.isSafeInteger(attempts) ||
      attempts < 0 ||
      attempts > 1_000_000)
  ) throw new Error("Completion batch attempts are invalid");
  const lastError = record.last_error === undefined
    ? undefined
    : boundedString(record.last_error, "Completion batch last_error", 4_096);
  const lastFailedAt = record.last_failed_at === undefined
    ? undefined
    : timestamp(record.last_failed_at, "Completion batch last_failed_at");
  if (Boolean(lastError) !== Boolean(lastFailedAt)) {
    throw new Error("Completion batch failure evidence is incomplete");
  }
  if (phase === "pending" && (queuedAt || presentedAt)) {
    throw new Error("Pending completion batch cannot have delivery timestamps");
  }
  if (phase === "queued" && (!queuedAt || presentedAt)) {
    throw new Error("Queued completion batch must have only queued_at");
  }
  if (phase === "presented" && (!queuedAt || !presentedAt)) {
    throw new Error("Presented completion batch requires queued_at and presented_at");
  }
  return {
    ...(attempts !== undefined ? { attempts } : {}),
    batch_id: boundedString(record.batch_id, "Completion batch id", 128),
    created_at: timestamp(record.created_at, "Completion batch created_at"),
    ...(lastError ? { last_error: lastError } : {}),
    ...(lastFailedAt ? { last_failed_at: lastFailedAt } : {}),
    members,
    phase,
    ...(queuedAt ? { queued_at: queuedAt } : {}),
    ...(presentedAt ? { presented_at: presentedAt } : {}),
  };
}

function parseSteer(value: unknown): RunSteerEnvelope {
  const record = asRecord(value, "Urgent steer envelope");
  assertExactFields(record, STEER_FIELDS, "Urgent steer envelope");
  const phase = record.phase;
  if (phase !== "pending" && phase !== "queued" && phase !== "presented") {
    throw new Error("Urgent steer phase is invalid");
  }
  const queuedAt = record.queued_at === undefined
    ? undefined
    : timestamp(record.queued_at, "Urgent steer queued_at");
  const presentedAt = record.presented_at === undefined
    ? undefined
    : timestamp(record.presented_at, "Urgent steer presented_at");
  if (phase === "pending" && (queuedAt || presentedAt)) {
    throw new Error("Pending urgent steer cannot have delivery timestamps");
  }
  if (phase === "queued" && (!queuedAt || presentedAt)) {
    throw new Error("Queued urgent steer must have only queued_at");
  }
  if (phase === "presented" && (!queuedAt || !presentedAt)) {
    throw new Error("Presented urgent steer requires queued_at and presented_at");
  }
  const attempts = record.attempts;
  if (
    attempts !== undefined &&
    (typeof attempts !== "number" ||
      !Number.isSafeInteger(attempts) ||
      attempts < 0 ||
      attempts > 1_000_000)
  ) throw new Error("Urgent steer attempts are invalid");
  const lastError = record.last_error === undefined
    ? undefined
    : boundedString(record.last_error, "Urgent steer last_error", 4_096);
  const lastFailedAt = record.last_failed_at === undefined
    ? undefined
    : timestamp(record.last_failed_at, "Urgent steer last_failed_at");
  if (Boolean(lastError) !== Boolean(lastFailedAt)) {
    throw new Error("Urgent steer failure evidence is incomplete");
  }
  const content = boundedString(
    record.content,
    "Urgent steer content",
    Limits.RUN_DELIVERY_STEER_MAX_BYTES,
  );
  if (Buffer.byteLength(content, "utf8") > Limits.RUN_DELIVERY_STEER_MAX_BYTES) {
    throw new Error("Urgent steer content exceeds the byte limit");
  }
  const level = record.level;
  if (level !== "info" && level !== "warning" && level !== "error") {
    throw new Error("Urgent steer level is invalid");
  }
  return {
    ...(attempts !== undefined ? { attempts } : {}),
    content,
    created_at: timestamp(record.created_at, "Urgent steer created_at"),
    event_id: boundedString(record.event_id, "Urgent steer event_id", 256),
    kind: boundedString(record.kind, "Urgent steer kind", 256),
    ...(lastError ? { last_error: lastError } : {}),
    ...(lastFailedAt ? { last_failed_at: lastFailedAt } : {}),
    level,
    occurred_at: timestamp(record.occurred_at, "Urgent steer occurred_at"),
    phase,
    ...(presentedAt ? { presented_at: presentedAt } : {}),
    ...(queuedAt ? { queued_at: queuedAt } : {}),
    run: boundedString(record.run, "Urgent steer run", 120),
    run_instance_id: boundedString(
      record.run_instance_id,
      "Urgent steer run_instance_id",
      256,
    ),
    state_dir: boundedString(record.state_dir, "Urgent steer state_dir", 4_096),
    steer_id: boundedString(record.steer_id, "Urgent steer id", 128),
  };
}

function parseReceipt(value: unknown): RunDeliveryReceipt {
  const record = asRecord(value, "Run delivery receipt");
  assertExactFields(record, RECEIPT_FIELDS, "Run delivery receipt");
  if (record.kind !== "completion_batch" && record.kind !== "urgent_steer") {
    throw new Error("Run delivery receipt kind is invalid");
  }
  return {
    delivery_id: boundedString(record.delivery_id, "Run delivery receipt id", 128),
    kind: record.kind,
    presented_at: timestamp(record.presented_at, "Run delivery receipt presented_at"),
  };
}

function emptyJournal(ownerId: string): RunDeliveryJournal {
  return {
    owner_id: ownerId,
    receipts: [],
    schema: RUN_DELIVERY_SCHEMA,
    steers: [],
  };
}

function parseJournal(value: unknown, ownerId: string): RunDeliveryJournal {
  const record = asRecord(value, "Run delivery journal");
  assertExactFields(record, JOURNAL_FIELDS, "Run delivery journal");
  if (record.schema !== RUN_DELIVERY_SCHEMA) {
    throw new Error("Run delivery journal schema is invalid");
  }
  if (record.owner_id !== ownerId) {
    throw new Error("Run delivery journal owner does not match the active owner");
  }
  if (!Array.isArray(record.receipts) || record.receipts.length > Limits.RUN_DELIVERY_RECEIPT_LIMIT) {
    throw new Error("Run delivery journal receipts are invalid");
  }
  const receipts = record.receipts.map(parseReceipt);
  if (new Set(receipts.map((receipt) =>
    `${receipt.kind}\0${receipt.delivery_id}`)).size !== receipts.length) {
    throw new Error("Run delivery journal has duplicate receipts");
  }
  const rawSteers = record.steers === undefined ? [] : record.steers;
  if (
    !Array.isArray(rawSteers) ||
    rawSteers.length > Limits.RUN_DELIVERY_STEER_MAX_ENVELOPES
  ) throw new Error("Run delivery journal urgent steers are invalid");
  const steers = rawSteers.map(parseSteer);
  if (new Set(steers.map((steer) => steer.steer_id)).size !== steers.length) {
    throw new Error("Run delivery journal has duplicate urgent steer ids");
  }
  return {
    ...(record.completion_batch !== undefined
      ? { completion_batch: parseBatch(record.completion_batch) }
      : {}),
    owner_id: ownerId,
    receipts,
    schema: RUN_DELIVERY_SCHEMA,
    steers,
  };
}

function ownerKey(ownerId: string): string {
  const exact = boundedString(ownerId, "Run delivery owner", 4_096);
  return createHash("sha256").update(exact).digest("hex");
}

export function getRunDeliveryJournalPath(tempDir: string, ownerId: string): string {
  return join(tempDir, "delivery", ownerKey(ownerId), "projection.json");
}

function assertNoDeliverySymlinks(tempDir: string, path: string): void {
  for (const candidate of [join(tempDir, "delivery"), dirname(path), path]) {
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`Run delivery state rejects symbolic link: ${candidate}`);
    }
  }
}

function readJournalAtPath(path: string, ownerId: string): RunDeliveryJournal {
  if (!existsSync(path)) return emptyJournal(ownerId);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > Limits.RUN_DELIVERY_JOURNAL_MAX_BYTES) {
    throw new Error("Run delivery journal is not a bounded regular file");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error("Run delivery journal is malformed", { cause: error });
  }
  return parseJournal(parsed, ownerId);
}

export function readRunDeliveryJournal(
  tempDir: string,
  ownerId: string,
): RunDeliveryJournal {
  const path = getRunDeliveryJournalPath(tempDir, ownerId);
  assertNoDeliverySymlinks(tempDir, path);
  return readJournalAtPath(path, ownerId);
}

function persistJournal(path: string, journal: RunDeliveryJournal): void {
  const content = `${JSON.stringify(journal, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > Limits.RUN_DELIVERY_JOURNAL_MAX_BYTES) {
    throw new Error("Run delivery journal exceeds the byte limit");
  }
  writeTextAtomic(path, content);
}

function mutateJournal<T>(
  tempDir: string,
  ownerId: string,
  mutate: (journal: RunDeliveryJournal) => T,
): T {
  const path = getRunDeliveryJournalPath(tempDir, ownerId);
  return withFileMutationLock(path, () => {
    assertNoDeliverySymlinks(tempDir, path);
    const journal = readJournalAtPath(path, ownerId);
    const result = mutate(journal);
    persistJournal(path, parseJournal(journal, ownerId));
    return result;
  });
}

export function admitRunCompletionBatch(
  input: AdmitRunCompletionBatchInput,
): RunCompletionBatch {
  const now = (input.now ?? new Date()).toISOString();
  const batch = parseBatch({
    batch_id: input.batchId ?? randomUUID(),
    created_at: now,
    members: input.members,
    phase: "pending",
  });
  return mutateJournal(input.tempDir, input.ownerId, (journal) => {
    if (journal.completion_batch) {
      throw new Error("Run delivery journal already has an active completion batch");
    }
    if (journal.receipts.some((receipt) => receipt.delivery_id === batch.batch_id)) {
      throw new Error("Run delivery batch id already has a presented receipt");
    }
    journal.completion_batch = batch;
    return batch;
  });
}

export function markRunCompletionBatchQueued(
  input: RunDeliveryTransitionInput,
): boolean {
  const now = (input.now ?? new Date()).toISOString();
  return mutateJournal(input.tempDir, input.ownerId, (journal) => {
    const batch = journal.completion_batch;
    if (!batch || batch.batch_id !== input.batchId) return false;
    if (batch.phase === "queued" || batch.phase === "presented") return true;
    batch.phase = "queued";
    batch.queued_at = now;
    return true;
  });
}

export function resetRunCompletionBatchPending(
  input: Omit<RunDeliveryTransitionInput, "now">,
): boolean {
  return mutateJournal(input.tempDir, input.ownerId, (journal) => {
    const batch = journal.completion_batch;
    if (!batch || batch.batch_id !== input.batchId || batch.phase === "presented") {
      return false;
    }
    if (batch.phase === "pending") return true;
    batch.phase = "pending";
    delete batch.queued_at;
    return true;
  });
}

export function recordRunCompletionBatchDeliveryFailure(
  input: RunDeliveryTransitionInput & { error: unknown },
): boolean {
  const now = (input.now ?? new Date()).toISOString();
  const raw = input.error instanceof Error ? input.error.message : String(input.error);
  const error = raw.replaceAll(/\s+/g, " ").trim().slice(0, 4_096) ||
    "Unknown completion delivery failure";
  return mutateJournal(input.tempDir, input.ownerId, (journal) => {
    const batch = journal.completion_batch;
    if (!batch || batch.batch_id !== input.batchId || batch.phase !== "pending") {
      return false;
    }
    batch.attempts = Math.min((batch.attempts ?? 0) + 1, 1_000_000);
    batch.last_error = error;
    batch.last_failed_at = now;
    return true;
  });
}

export function markRunCompletionBatchPresented(
  input: RunDeliveryTransitionInput,
): boolean {
  const now = (input.now ?? new Date()).toISOString();
  return mutateJournal(input.tempDir, input.ownerId, (journal) => {
    const batch = journal.completion_batch;
    if (!batch || batch.batch_id !== input.batchId || batch.phase === "pending") return false;
    if (batch.phase === "presented") return true;
    batch.phase = "presented";
    batch.presented_at = now;
    return true;
  });
}

export function finalizeRunCompletionBatch(
  input: Omit<RunDeliveryTransitionInput, "now">,
): boolean {
  return mutateJournal(input.tempDir, input.ownerId, (journal) => {
    const batch = journal.completion_batch;
    if (!batch || batch.batch_id !== input.batchId) {
      return journal.receipts.some((receipt) => receipt.delivery_id === input.batchId);
    }
    if (batch.phase !== "presented" || !batch.presented_at) return false;
    journal.receipts = [
      ...journal.receipts.filter((receipt) => receipt.delivery_id !== batch.batch_id),
      {
        delivery_id: batch.batch_id,
        kind: "completion_batch",
        presented_at: batch.presented_at,
      } satisfies RunDeliveryReceipt,
    ].slice(-Limits.RUN_DELIVERY_RECEIPT_LIMIT);
    delete journal.completion_batch;
    return true;
  });
}

export function getRunSteerDeliveryId(input: {
  eventId: string;
  runInstanceId: string;
  stateDir: string;
}): string {
  return createHash("sha256").update(JSON.stringify([
    input.stateDir,
    input.runInstanceId,
    input.eventId,
  ])).digest("hex");
}

export function admitRunSteerEnvelope(
  input: AdmitRunSteerEnvelopeInput,
): RunSteerEnvelope | undefined {
  const steer = parseSteer({
    content: input.content,
    created_at: (input.now ?? new Date()).toISOString(),
    event_id: input.eventId,
    kind: input.kind,
    level: input.level,
    occurred_at: input.occurredAt,
    phase: "pending",
    run: input.run,
    run_instance_id: input.runInstanceId,
    state_dir: input.stateDir,
    steer_id: input.steerId ?? getRunSteerDeliveryId(input),
  });
  return mutateJournal(input.tempDir, input.ownerId, (journal) => {
    const existing = journal.steers.find((item) => item.steer_id === steer.steer_id);
    if (existing) {
      if (
        existing.content !== steer.content ||
        existing.event_id !== steer.event_id ||
        existing.run_instance_id !== steer.run_instance_id ||
        existing.state_dir !== steer.state_dir
      ) throw new Error("Urgent steer id conflicts with a different envelope");
      return existing;
    }
    if (journal.receipts.some((receipt) =>
      receipt.kind === "urgent_steer" && receipt.delivery_id === steer.steer_id)) {
      return undefined;
    }
    if (journal.steers.length >= Limits.RUN_DELIVERY_STEER_MAX_ENVELOPES) {
      throw Object.assign(new Error("Run delivery urgent steer capacity is full"), {
        code: "RUN_STEER_CAPACITY",
      });
    }
    journal.steers.push(steer);
    return steer;
  });
}

function mutateSteer(
  input: RunSteerTransitionInput,
  mutate: (steer: RunSteerEnvelope) => boolean,
): boolean {
  return mutateJournal(input.tempDir, input.ownerId, (journal) => {
    const steer = journal.steers.find((item) => item.steer_id === input.steerId);
    return steer ? mutate(steer) : false;
  });
}

export function markRunSteerQueued(input: RunSteerTransitionInput): boolean {
  const now = (input.now ?? new Date()).toISOString();
  return mutateSteer(input, (steer) => {
    if (steer.phase === "queued" || steer.phase === "presented") return true;
    steer.phase = "queued";
    steer.queued_at = now;
    return true;
  });
}

export function resetRunSteerPending(
  input: Omit<RunSteerTransitionInput, "now">,
): boolean {
  return mutateSteer(input, (steer) => {
    if (steer.phase === "presented") return false;
    if (steer.phase === "pending") return true;
    steer.phase = "pending";
    delete steer.queued_at;
    return true;
  });
}

export function recordRunSteerDeliveryFailure(
  input: RunSteerTransitionInput & { error: unknown },
): boolean {
  const now = (input.now ?? new Date()).toISOString();
  const raw = input.error instanceof Error ? input.error.message : String(input.error);
  const error = raw.replaceAll(/\s+/g, " ").trim().slice(0, 4_096) ||
    "Unknown urgent steer delivery failure";
  return mutateSteer(input, (steer) => {
    if (steer.phase !== "pending") return false;
    steer.attempts = Math.min((steer.attempts ?? 0) + 1, 1_000_000);
    steer.last_error = error;
    steer.last_failed_at = now;
    return true;
  });
}

export function markRunSteerPresented(input: RunSteerTransitionInput): boolean {
  const now = (input.now ?? new Date()).toISOString();
  return mutateSteer(input, (steer) => {
    if (steer.phase === "pending") return false;
    if (steer.phase === "presented") return true;
    steer.phase = "presented";
    steer.presented_at = now;
    return true;
  });
}

export function finalizeRunSteer(
  input: Omit<RunSteerTransitionInput, "now">,
): boolean {
  return mutateJournal(input.tempDir, input.ownerId, (journal) => {
    const index = journal.steers.findIndex((item) => item.steer_id === input.steerId);
    if (index < 0) return journal.receipts.some((receipt) =>
      receipt.kind === "urgent_steer" && receipt.delivery_id === input.steerId);
    const steer = journal.steers[index]!;
    if (steer.phase !== "presented" || !steer.presented_at) return false;
    journal.steers.splice(index, 1);
    journal.receipts = [
      ...journal.receipts.filter((receipt) =>
        receipt.kind !== "urgent_steer" || receipt.delivery_id !== steer.steer_id),
      {
        delivery_id: steer.steer_id,
        kind: "urgent_steer",
        presented_at: steer.presented_at,
      } satisfies RunDeliveryReceipt,
    ].slice(-Limits.RUN_DELIVERY_RECEIPT_LIMIT);
    return true;
  });
}

function compactModelText(value: string, limit: number): string {
  const compact = value.replaceAll(/\s+/g, " ").replaceAll("`", "'").trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function formatCompletionMember(member: RunCompletionBatchMember): string {
  const summary = compactModelText(member.summary, 200);
  const artifactEntries = Object.entries(member.artifacts ?? {}).slice(0, 4);
  const artifactText = artifactEntries.length === 0
    ? ""
    : `; artifacts: ${artifactEntries.map(([name, path]) =>
      `${compactModelText(name, 120)}=\`${compactModelText(path, 320)}\``
    ).join(", ")}`;
  return `- \`${compactModelText(member.run, 120)}\` — \`${member.status}\`: ${summary}${artifactText}`;
}

function formatStatusCounts(members: RunCompletionBatchMember[]): string {
  const counts = new Map<RunCompletionDeliveryStatus, number>();
  for (const member of members) {
    counts.set(member.status, (counts.get(member.status) ?? 0) + 1);
  }
  return (["done", "failed", "killed", "exited"] as const)
    .filter((status) => counts.has(status))
    .map((status) => `${status}=${counts.get(status)}`)
    .join(" ");
}

/** Format one immutable batch for a model-bound custom message. */
export function formatRunCompletionBatchMessage(batch: RunCompletionBatch): string {
  const safe = parseBatch(batch);
  const terminalTimes = safe.members.map((member) => member.terminal_at).sort();
  const header = [
    `Actor completions: ${safe.members.length}`,
    `Batch: \`${compactModelText(safe.batch_id, 128)}\``,
    `Window: \`${terminalTimes[0]}\` → \`${terminalTimes.at(-1)}\``,
    `Statuses: \`${formatStatusCounts(safe.members)}\``,
  ];
  const candidateRows = safe.members
    .slice(0, Limits.RUN_DELIVERY_MODEL_MAX_MEMBERS)
    .map(formatCompletionMember);
  const rows: string[] = [];
  for (const row of candidateRows) {
    const omitted = safe.members.length - rows.length - 1;
    const candidate = [
      ...header,
      ...rows,
      row,
      ...(omitted > 0 ? [`… ${omitted} more completion(s) retained in batch.`] : []),
    ].join("\n");
    if (Buffer.byteLength(candidate, "utf8") > Limits.RUN_DELIVERY_MODEL_MAX_BYTES) break;
    rows.push(row);
  }
  const omitted = safe.members.length - rows.length;
  const message = [
    ...header,
    ...rows,
    ...(omitted > 0 ? [`… ${omitted} more completion(s) retained in batch.`] : []),
  ].join("\n");
  if (Buffer.byteLength(message, "utf8") > Limits.RUN_DELIVERY_MODEL_MAX_BYTES) {
    throw new Error("Run completion batch header exceeds the model byte limit");
  }
  return message;
}
