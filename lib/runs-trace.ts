/**
 * Run Trace event journal.
 * Zones: structured event validation, bounded atomic retention, resilient reads
 * Owns canonical Run-local Trace persistence; lifecycle projection and owner attention delivery stay in adapters.
 */

import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { withFileMutationLock, writeTextAtomic } from "./file-state.ts";
import * as Limits from "./limits.ts";
import {
  accumulateTraceCompactionStatistics,
  selectNewestTraceSuffix,
  traceAppendFits,
  traceCompactionMarkerInput,
  TRACE_COMPACTION_KIND,
  TRACE_COMPACTION_VERSION,
  type TraceCompactionData,
  type TraceRetentionCandidate,
} from "./run-evidence-policy.ts";
import type { StateReadDiagnostic } from "./state-readers.ts";

export interface TraceEvent {
  id: string;
  ts: string;
  kind: string;
  summary?: string;
  data?: unknown;
  level?: "info" | "warning" | "error";
  attention?: "notify" | "followup" | "steer";
}

export interface AppendTraceEventInput {
  kind: string;
  summary?: string;
  data?: unknown;
  level?: TraceEvent["level"];
  attention?: TraceEvent["attention"];
}

interface EncodedTraceEvent {
  encoded: string;
  encodedBytes: number;
  event: TraceEvent;
}

interface TraceReadWindow {
  content: Buffer;
  fileBytes: number;
  leadingPartialLines: number;
  omittedPrefixBytes: number;
  readBytes: number;
}

export interface RunTraceReadEvent {
  event: TraceEvent;
  ordinal: number;
}
export interface RunTraceJournalRead {
  diagnostics: StateReadDiagnostic[];
  events: RunTraceReadEvent[];
  fileBytes: number;
  omittedPrefixBytes: number;
  readBytes: number;
}
export interface RunTraceSummary {
  compacted: boolean; compactions_total: number; dropped_bytes: number;
  dropped_event_count_exact: boolean; dropped_events: number;
  history_complete: boolean; retained_bytes: number; retained_events: number;
}
interface ParsedTraceJournal {
  candidateBytes: number;
  candidates: TraceRetentionCandidate<EncodedTraceEvent>[];
  droppedBytes: number;
  droppedValidEvents: number;
  malformedLines: number;
  physicalEvents: number;
  previousCompaction?: TraceCompactionData;
}

const KIND_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/;
const TRACE_FIELDS = new Set([
  "attention",
  "data",
  "id",
  "kind",
  "level",
  "summary",
  "ts",
]);
const TRACE_INPUT_FIELDS = new Set([
  "attention",
  "data",
  "kind",
  "level",
  "summary",
]);
const FORBIDDEN_FIELDS = new Set([
  "body",
  "correlation_id",
  "from",
  "metadata",
  "reply_to",
  "to",
  "type",
]);
const COMPACTION_DATA_FIELDS = new Set([
  "compactions_total",
  "dropped_bytes_total",
  "dropped_event_count_exact",
  "dropped_malformed_lines_total",
  "dropped_valid_events_total",
  "history_complete",
  "retained_bytes",
  "retained_events",
  "version",
]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export function runTraceFile(stateDir: string): string {
  return join(stateDir, "trace.jsonl");
}

function hasExactFields(record: Record<string, unknown>, fields: Set<string>): boolean {
  const keys = Object.keys(record);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function normalizeTraceEventInput(input: unknown): AppendTraceEventInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Trace event must be an object");
  }
  const record = input as Record<string, unknown>;
  const forbidden = Object.keys(record).filter((key) => FORBIDDEN_FIELDS.has(key));
  if (forbidden.length > 0) {
    throw new Error(`Trace event fields are removed: ${forbidden.sort().join(", ")}`);
  }
  const unknown = Object.keys(record).filter((key) => !TRACE_INPUT_FIELDS.has(key));
  if (unknown.length > 0) {
    throw new Error(`Unsupported Trace event fields: ${unknown.sort().join(", ")}`);
  }
  if (typeof record.kind !== "string" || !KIND_PATTERN.test(record.kind)) {
    throw new Error("Trace event kind must be a lowercase semantic token");
  }
  if (record.kind === TRACE_COMPACTION_KIND) {
    throw new Error(`Trace event kind is runtime-reserved: ${TRACE_COMPACTION_KIND}`);
  }
  if (record.summary !== undefined && typeof record.summary !== "string") {
    throw new Error("Trace event summary must be a string");
  }
  if (
    record.level !== undefined &&
    record.level !== "info" &&
    record.level !== "warning" &&
    record.level !== "error"
  ) {
    throw new Error("Trace event level must be info, warning, or error");
  }
  if (
    record.attention !== undefined &&
    record.attention !== "notify" &&
    record.attention !== "followup" &&
    record.attention !== "steer"
  ) {
    throw new Error("Trace event attention must be notify, followup, or steer");
  }
  return {
    kind: record.kind,
    ...(record.summary !== undefined
      ? { summary: record.summary.slice(0, 1_000) }
      : {}),
    ...(record.data !== undefined ? { data: record.data } : {}),
    ...(record.level !== undefined
      ? { level: record.level as TraceEvent["level"] }
      : {}),
    ...(record.attention !== undefined
      ? { attention: record.attention as TraceEvent["attention"] }
      : {}),
  };
}

function encodeTraceEvent(event: TraceEvent): EncodedTraceEvent {
  let serialized: string;
  try {
    serialized = JSON.stringify(event);
  } catch {
    throw new Error("Trace event data must be JSON-serializable");
  }
  if (Buffer.byteLength(serialized) > Limits.TRACE_EVENT_MAX_BYTES) {
    throw new Error(`Trace event exceeds ${Limits.TRACE_EVENT_MAX_BYTES} bytes`);
  }
  const encoded = `${serialized}\n`;
  return { encoded, encodedBytes: Buffer.byteLength(encoded), event };
}

function createTraceEvent(input: AppendTraceEventInput): EncodedTraceEvent {
  return encodeTraceEvent({
    id: randomUUID(),
    ts: new Date().toISOString(),
    ...normalizeTraceEventInput(input),
  });
}

function readTraceWindow(path: string): TraceReadWindow {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        content: Buffer.alloc(0),
        fileBytes: 0,
        leadingPartialLines: 0,
        omittedPrefixBytes: 0,
        readBytes: 0,
      };
    }
    throw error;
  }
  try {
    const fileBytes = fstatSync(fd).size;
    if (!Number.isSafeInteger(fileBytes) || fileBytes < 0) {
      throw new Error("Trace journal size is not safely representable");
    }
    const readBytes = Math.min(fileBytes, Limits.TRACE_JOURNAL_MAX_BYTES);
    const offset = fileBytes - readBytes;
    const buffer = Buffer.allocUnsafe(readBytes);
    let consumed = 0;
    while (consumed < readBytes) {
      const count = readSync(fd, buffer, consumed, readBytes - consumed, offset + consumed);
      if (count === 0) throw new Error("Trace journal changed during bounded read");
      consumed += count;
    }
    if (fstatSync(fd).size !== fileBytes) {
      throw new Error("Trace journal changed during bounded read");
    }
    if (offset === 0) {
      return {
        content: buffer,
        fileBytes,
        leadingPartialLines: 0,
        omittedPrefixBytes: 0,
        readBytes,
      };
    }
    const preceding = Buffer.allocUnsafe(1);
    if (readSync(fd, preceding, 0, 1, offset - 1) !== 1) {
      throw new Error("Trace journal changed during bounded read");
    }
    if (preceding[0] === 0x0a) {
      return {
        content: buffer,
        fileBytes,
        leadingPartialLines: 0,
        omittedPrefixBytes: offset,
        readBytes,
      };
    }
    const newline = buffer.indexOf(0x0a);
    const discarded = newline < 0 ? buffer.length : newline + 1;
    return {
      content: buffer.subarray(discarded),
      fileBytes,
      leadingPartialLines: 1,
      omittedPrefixBytes: offset + discarded,
      readBytes,
    };
  } finally {
    closeSync(fd);
  }
}

function isTraceEvent(value: unknown): value is TraceEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !TRACE_FIELDS.has(key))) return false;
  if (
    typeof record.id !== "string" || !record.id ||
    typeof record.ts !== "string" || !Number.isFinite(Date.parse(record.ts)) ||
    typeof record.kind !== "string" || !KIND_PATTERN.test(record.kind)
  ) return false;
  if (record.summary !== undefined && typeof record.summary !== "string") return false;
  if (
    record.level !== undefined &&
    record.level !== "info" &&
    record.level !== "warning" &&
    record.level !== "error"
  ) return false;
  return record.attention === undefined ||
    record.attention === "notify" ||
    record.attention === "followup" ||
    record.attention === "steer";
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function compactionData(value: unknown): TraceCompactionData | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!hasExactFields(record, COMPACTION_DATA_FIELDS)) return undefined;
  if (
    record.version !== TRACE_COMPACTION_VERSION ||
    !isCount(record.compactions_total) ||
    !isCount(record.dropped_valid_events_total) ||
    !isCount(record.dropped_malformed_lines_total) ||
    !isCount(record.dropped_bytes_total) ||
    typeof record.dropped_event_count_exact !== "boolean" ||
    !isCount(record.retained_events) ||
    !isCount(record.retained_bytes) ||
    record.history_complete !== false
  ) return undefined;
  return record as unknown as TraceCompactionData;
}

function markerData(event: TraceEvent): TraceCompactionData | undefined {
  return event.kind === TRACE_COMPACTION_KIND &&
      event.level === "warning" &&
      event.summary === undefined &&
      event.attention === undefined
    ? compactionData(event.data)
    : undefined;
}

function decodeTraceLine(line: Buffer): { event: TraceEvent; text: string } {
  if (line.length === 0 || line.length > Limits.TRACE_EVENT_MAX_BYTES) {
    throw new Error("Trace journal line is empty or oversized");
  }
  const text = UTF8_DECODER.decode(line);
  const event = JSON.parse(text) as unknown;
  if (!isTraceEvent(event) ||
      (event.kind === TRACE_COMPACTION_KIND && !markerData(event))) {
    throw new Error("Trace journal line is not a canonical event");
  }
  return { event, text };
}

function parseTraceJournal(window: TraceReadWindow): ParsedTraceJournal {
  let candidates: TraceRetentionCandidate<EncodedTraceEvent>[] = [];
  let candidateHead = 0;
  let candidateBytes = 0;
  let droppedBytes = window.omittedPrefixBytes;
  let droppedValidEvents = 0;
  let malformedLines = window.leadingPartialLines;
  let physicalEvents = 0;
  let previousCompaction: TraceCompactionData | undefined;
  const dropOldestCandidate = (): void => {
    const dropped = candidates[candidateHead++]!;
    candidateBytes -= dropped.encodedBytes;
    droppedBytes += dropped.encodedBytes;
    droppedValidEvents += 1;
    if (candidateHead > 2_048) {
      candidates = candidates.slice(candidateHead);
      candidateHead = 0;
    }
  };
  const consume = (line: Buffer, physicalBytes: number): void => {
    let decoded: ReturnType<typeof decodeTraceLine>;
    try {
      decoded = decodeTraceLine(line);
    } catch {
      malformedLines += 1;
      droppedBytes += physicalBytes;
      return;
    }
    const { event, text } = decoded;
    physicalEvents += 1;
    if (event.kind === TRACE_COMPACTION_KIND) {
      previousCompaction = markerData(event)!;
      return;
    }
    const encoded = `${text}\n`;
    const candidate: TraceRetentionCandidate<EncodedTraceEvent> = {
      encodedBytes: Buffer.byteLength(encoded),
      value: { encoded, encodedBytes: Buffer.byteLength(encoded), event },
    };
    candidates.push(candidate);
    candidateBytes += candidate.encodedBytes;
    while (
      candidates.length - candidateHead > Limits.TRACE_JOURNAL_TARGET_EVENTS ||
      candidateBytes > Limits.TRACE_JOURNAL_TARGET_BYTES
    ) dropOldestCandidate();
  };
  let start = 0;
  while (start < window.content.length) {
    const newline = window.content.indexOf(0x0a, start);
    if (newline < 0) {
      malformedLines += 1;
      droppedBytes += window.content.length - start;
      break;
    }
    consume(window.content.subarray(start, newline), newline - start + 1);
    start = newline + 1;
  }
  candidates = candidates.slice(candidateHead);
  return {
    candidateBytes,
    candidates,
    droppedBytes,
    droppedValidEvents,
    malformedLines,
    physicalEvents,
    ...(previousCompaction ? { previousCompaction } : {}),
  };
}

function markerReserveBytes(id: string, ts: string): number {
  const maximum = Number.MAX_SAFE_INTEGER;
  return encodeTraceEvent({
    id,
    ts,
    ...traceCompactionMarkerInput({
      version: TRACE_COMPACTION_VERSION,
      compactions_total: maximum,
      dropped_valid_events_total: maximum,
      dropped_malformed_lines_total: maximum,
      dropped_bytes_total: maximum,
      dropped_event_count_exact: false,
      retained_events: maximum,
      retained_bytes: maximum,
      history_complete: false,
    }),
  }).encodedBytes;
}

function createCompactionMarker(
  id: string,
  ts: string,
  previous: TraceCompactionData | undefined,
  delta: Omit<Parameters<typeof accumulateTraceCompactionStatistics>[1], "retained_bytes">,
  retainedWithoutMarkerBytes: number,
): EncodedTraceEvent {
  let markerBytes = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const data = accumulateTraceCompactionStatistics(previous, {
      ...delta,
      retained_bytes: retainedWithoutMarkerBytes + markerBytes,
    });
    const marker = encodeTraceEvent({
      id,
      ts,
      ...traceCompactionMarkerInput(data),
    });
    if (marker.encodedBytes === markerBytes) return marker;
    markerBytes = marker.encodedBytes;
  }
  throw new Error("Trace compaction marker size did not converge");
}

function compactTraceJournal(
  path: string,
  window: TraceReadWindow,
  parsed: ParsedTraceJournal,
  appended: EncodedTraceEvent,
): void {
  const markerId = randomUUID();
  const markerTs = new Date().toISOString();
  const reserveBytes = markerReserveBytes(markerId, markerTs);
  const selection = selectNewestTraceSuffix(parsed.candidates, {
    bytes: appended.encodedBytes + reserveBytes,
    events: 2,
  });
  const marker = createCompactionMarker(
    markerId,
    markerTs,
    parsed.previousCompaction,
    {
      dropped_valid_events: parsed.droppedValidEvents + selection.droppedEvents,
      dropped_malformed_lines: parsed.malformedLines,
      dropped_bytes:
        parsed.droppedBytes + parsed.candidateBytes - selection.retainedBytes,
      dropped_event_count_exact: window.omittedPrefixBytes === 0,
      retained_events: selection.retainedEvents + 2,
    },
    selection.retainedBytes + appended.encodedBytes,
  );
  if (marker.encodedBytes > reserveBytes) {
    throw new Error("Trace compaction marker exceeded its reserved bound");
  }
  const content = [
    ...selection.retained.map(({ value }) => value.encoded),
    appended.encoded,
    marker.encoded,
  ].join("");
  const bytes = Buffer.byteLength(content);
  const events = selection.retainedEvents + 2;
  if (
    bytes > Limits.TRACE_JOURNAL_TARGET_BYTES ||
    events > Limits.TRACE_JOURNAL_TARGET_EVENTS ||
    bytes > Limits.TRACE_JOURNAL_MAX_BYTES ||
    events > Limits.TRACE_JOURNAL_MAX_EVENTS
  ) {
    throw new Error("Trace compaction could not satisfy journal bounds");
  }
  writeTextAtomic(path, content);
}

export function appendRunTraceEvent(
  stateDir: string,
  input: AppendTraceEventInput,
): TraceEvent {
  const appended = createTraceEvent(input);
  const path = runTraceFile(stateDir);
  return withFileMutationLock(path, () => {
    const window = readTraceWindow(path);
    const parsed = parseTraceJournal(window);
    const completeJournal =
      window.omittedPrefixBytes === 0 && parsed.malformedLines === 0;
    if (
      completeJournal &&
      traceAppendFits(
        { bytes: window.fileBytes, events: parsed.physicalEvents },
        appended.encodedBytes,
      )
    ) {
      writeFileSync(path, appended.encoded, { flag: "a" });
    } else {
      compactTraceJournal(path, window, parsed, appended);
    }
    return appended.event;
  });
}

export function readRunTraceJournal(stateDir: string): RunTraceJournalRead {
  const path = runTraceFile(stateDir);
  let window: TraceReadWindow;
  try {
    window = readTraceWindow(path);
  } catch (error) {
    return {
      diagnostics: [{
        message: error instanceof Error ? error.message : String(error),
        path,
      }],
      events: [],
      fileBytes: 0,
      omittedPrefixBytes: 0,
      readBytes: 0,
    };
  }
  const diagnostics: StateReadDiagnostic[] = [];
  let events: RunTraceReadEvent[] = [];
  let eventHead = 0;
  let ordinal = window.leadingPartialLines;
  const diagnose = (message: string, line?: number): void => {
    diagnostics.push({ message, path, ...(line === undefined ? {} : { line }) });
    if (diagnostics.length > Limits.TRACE_EVENT_MAX_READ) diagnostics.shift();
  };
  const retain = (event: TraceEvent): void => {
    events.push({ event, ordinal });
    if (events.length - eventHead > Limits.TRACE_JOURNAL_MAX_EVENTS) eventHead += 1;
    if (eventHead > Limits.TRACE_JOURNAL_MAX_EVENTS) {
      events = events.slice(eventHead);
      eventHead = 0;
    }
  };
  if (window.leadingPartialLines) {
    diagnose("Omitted partial leading Trace line", 1);
  }
  let start = 0;
  while (start < window.content.length) {
    ordinal += 1;
    const newline = window.content.indexOf(0x0a, start);
    if (newline < 0) {
      diagnose("Incomplete trailing Trace line", ordinal);
      break;
    }
    try {
      retain(decodeTraceLine(window.content.subarray(start, newline)).event);
    } catch (error) {
      diagnose(error instanceof Error ? error.message : String(error), ordinal);
    }
    start = newline + 1;
  }
  return {
    diagnostics,
    events: events.slice(eventHead),
    fileBytes: window.fileBytes,
    omittedPrefixBytes: window.omittedPrefixBytes,
    readBytes: window.readBytes,
  };
}

export function summarizeRunTraceJournal(read: RunTraceJournalRead): RunTraceSummary {
  const marker = [...read.events].reverse().map(({ event }) => markerData(event)).find(Boolean);
  const incomplete = Boolean(marker) || read.omittedPrefixBytes > 0;
  return {
    history_complete: !incomplete, compacted: Boolean(marker),
    compactions_total: marker?.compactions_total ?? 0,
    dropped_events: marker?.dropped_valid_events_total ?? 0,
    dropped_bytes: marker?.dropped_bytes_total ?? read.omittedPrefixBytes,
    dropped_event_count_exact: marker?.dropped_event_count_exact ?? !incomplete,
    retained_events: read.events.length, retained_bytes: read.readBytes,
  };
}

export function readRunTraceEvents(
  stateDir: string,
  limit = Limits.TRACE_EVENT_MAX_READ,
): TraceEvent[] {
  return readRunTraceJournal(stateDir).events
    .slice(-Math.max(1, Math.min(limit, Limits.TRACE_EVENT_MAX_READ)))
    .map(({ event }) => event);
}
