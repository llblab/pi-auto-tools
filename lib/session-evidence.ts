/**
 * Persisted Pi session evidence reader.
 * Zones: subagent turns, active session branches, bounded/redacted previews
 * Owns read-only normalization of session JSONL into inspector-ready turns.
 */

import * as Limits from "./limits.ts";
import {
  readJsonlFileResilient,
  type StateReadDiagnostic,
} from "./state-readers.ts";

interface SessionEntry {
  id?: unknown;
  message?: unknown;
  parentId?: unknown;
  timestamp?: unknown;
  type?: unknown;
  [key: string]: unknown;
}

export interface SessionEvidenceToolCall {
  arguments?: unknown;
  id: string;
  name: string;
  result?: unknown;
  resultError?: boolean;
}

export interface SessionEvidenceTurn {
  assistantEntryId?: string;
  assistantText?: string;
  error?: string;
  index: number;
  model?: string;
  provider?: string;
  stopReason?: string;
  thinking?: string;
  timestamp?: string;
  toolCalls: SessionEvidenceToolCall[];
  unmatchedToolResults: number;
  usage?: unknown;
  userEntryId?: string;
  userText?: string;
}

export interface SessionEvidence {
  activeLeafId?: string;
  diagnostics: StateReadDiagnostic[];
  path: string;
  session?: Record<string, unknown>;
  totalTurns: number;
  truncated: boolean;
  turns: SessionEvidenceTurn[];
}

export interface SessionEvidenceReadOptions {
  maxBytes?: number;
  maxTextChars?: number;
  maxToolCalls?: number;
  maxTurns?: number;
}

export type ActiveSessionEntryMatch = "present" | "conflict" | undefined;
export interface ActiveSessionEntryEvidence {
  examinedBytes: number;
  examinedEntries: number;
  reason?: string;
  status: "present" | "absent" | "conflict" | "unknown";
}

export interface ActiveSessionEntryEvidenceInput {
  getEntry(id: string): unknown;
  leaf: unknown;
  match(entry: Record<string, unknown>): ActiveSessionEntryMatch;
  maxBytes?: number;
  maxEntries?: number;
}

const SENSITIVE_KEY = /(?:^|[_-])(?:api[-_]?key|authorization|cookie|credential|password|private[-_]?key|secret|secret[-_]?access[-_]?key|token)$|^(?:access|refresh|auth|api)Token$|^(?:clientSecret|privateKey|secretAccessKey)$/i;

function boundedJsonStringBytes(value: string): number {
  let bytes = Buffer.byteLength(value, "utf8") + 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) bytes += 1;
    else if (code < 0x20) bytes += [0x08, 0x09, 0x0a, 0x0c, 0x0d].includes(code) ? 1 : 5;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      else bytes += 3;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 3;
  }
  return bytes;
}

function boundedJsonBytes(
  value: unknown,
  ceiling: number,
  seen = new WeakSet<object>(),
): number | undefined {
  if (value === null) return 4;
  if (typeof value === "string") return boundedJsonStringBytes(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value).length : 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  let bytes = 2;
  const values: Array<[string | undefined, unknown]> = Array.isArray(value)
    ? value.map((item) => [
      undefined,
      item === undefined || typeof item === "function" || typeof item === "symbol"
        ? null
        : item,
    ])
    : Object.entries(value as Record<string, unknown>).filter(([, item]) =>
      item !== undefined && typeof item !== "function" && typeof item !== "symbol");
  for (const [key, item] of values) {
    if (bytes > ceiling) break;
    if (bytes > 2) bytes += 1;
    if (key !== undefined) bytes += boundedJsonStringBytes(key) + 1;
    const itemBytes = boundedJsonBytes(item, ceiling - bytes, seen);
    if (itemBytes === undefined) {
      seen.delete(value);
      return undefined;
    }
    bytes += itemBytes;
  }
  seen.delete(value);
  return bytes;
}

/** Walk only the active parent chain under exact entry and byte ceilings. */
export function inspectBoundedActiveSessionEntries(
  input: ActiveSessionEntryEvidenceInput,
): ActiveSessionEntryEvidence {
  const maxBytes = input.maxBytes ?? Limits.RUN_DELIVERY_SESSION_MAX_BYTES;
  const maxEntries = input.maxEntries ?? Limits.RUN_DELIVERY_SESSION_MAX_ENTRIES;
  if (input.leaf === undefined || input.leaf === null) {
    return { examinedBytes: 0, examinedEntries: 0, status: "absent" };
  }
  const visited = new Set<string>();
  let current: unknown = input.leaf;
  let examinedBytes = 0;
  let examinedEntries = 0;
  while (current !== undefined) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return {
        examinedBytes,
        examinedEntries,
        reason: "active session entry is malformed",
        status: "unknown",
      };
    }
    const entry = current as Record<string, unknown>;
    if (typeof entry.id !== "string" || !entry.id) {
      return {
        examinedBytes,
        examinedEntries,
        reason: "active session entry id is malformed",
        status: "unknown",
      };
    }
    if (visited.has(entry.id)) {
      return {
        examinedBytes,
        examinedEntries,
        reason: "active session entry cycle detected",
        status: "unknown",
      };
    }
    visited.add(entry.id);
    const bytes = boundedJsonBytes(entry, maxBytes - examinedBytes);
    if (bytes === undefined) {
      return {
        examinedBytes,
        examinedEntries,
        reason: "active session entry is not serializable",
        status: "unknown",
      };
    }
    if (examinedEntries >= maxEntries || examinedBytes + bytes > maxBytes) {
      return {
        examinedBytes,
        examinedEntries,
        reason: "active session evidence exceeds its inspection bound",
        status: "unknown",
      };
    }
    examinedEntries += 1;
    examinedBytes += bytes;
    const matched = input.match(entry);
    if (matched) return { examinedBytes, examinedEntries, status: matched };
    if (entry.parentId === null) {
      return { examinedBytes, examinedEntries, status: "absent" };
    }
    if (typeof entry.parentId !== "string" || !entry.parentId) {
      return {
        examinedBytes,
        examinedEntries,
        reason: "active session parent is malformed",
        status: "unknown",
      };
    }
    current = input.getEntry(entry.parentId);
    if (current === undefined) {
      return {
        examinedBytes,
        examinedEntries,
        reason: "active session parent is unavailable",
        status: "unknown",
      };
    }
  }
  return { examinedBytes, examinedEntries, status: "unknown" };
}
const SENSITIVE_TEXT = /(bearer\s+)[A-Za-z0-9._~+/=-]+|["']?\b(api[-_]?key|authorization|clientSecret|cookie|password|private[-_]?key|privateKey|secret|secretAccessKey|token)["']?(\s*[:=]\s*)["']?([^\s,;"'}]+)/gi;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/^\s*[\[{]/.test(value)) {
    try {
      const structured = JSON.stringify(
        redactSessionEvidenceValue(JSON.parse(value), maxChars),
      );
      return structured.length > maxChars
        ? `${structured.slice(0, Math.max(0, maxChars - 1))}…`
        : structured;
    } catch {
      // Fall through to bounded text redaction.
    }
  }
  const redacted = value.replaceAll(
    SENSITIVE_TEXT,
    (match, bearer: string | undefined, key: string | undefined, separator: string | undefined) =>
      bearer ? `${bearer}[REDACTED]` : `${key}${separator}[REDACTED]`,
  );
  return redacted.length > maxChars
    ? `${redacted.slice(0, Math.max(0, maxChars - 1))}…`
    : redacted;
}

export function redactSessionEvidenceValue(
  value: unknown,
  maxTextChars = Limits.SESSION_EVIDENCE_TEXT_CHARS,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return boundedText(value, maxTextChars);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactSessionEvidenceValue(item, maxTextChars, seen));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : redactSessionEvidenceValue(item, maxTextChars, seen),
    ]),
  );
}

function contentBlocks(message: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(message.content)
    ? message.content.map(asRecord)
    : typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : [];
}

function contentText(
  message: Record<string, unknown>,
  type: "text" | "thinking",
  maxChars: number,
): string | undefined {
  const text = contentBlocks(message)
    .filter((block) => block.type === type && typeof block[type] === "string")
    .map((block) => String(block[type]))
    .join("\n");
  return boundedText(text, maxChars);
}

function activeBranch(
  entries: SessionEntry[],
  path: string,
  diagnostics: StateReadDiagnostic[],
): SessionEntry[] {
  const treeEntries = entries.filter(
    (entry) => entry.type !== "session" && typeof entry.id === "string",
  );
  const leaf = treeEntries.at(-1);
  if (!leaf || typeof leaf.id !== "string") return [];
  const byId = new Map(
    treeEntries.map((entry) => [String(entry.id), entry] as const),
  );
  const branch: SessionEntry[] = [];
  const visited = new Set<string>();
  let current: SessionEntry | undefined = leaf;
  while (current && typeof current.id === "string") {
    if (visited.has(current.id)) {
      diagnostics.push({ message: `session entry cycle at ${current.id}`, path });
      break;
    }
    visited.add(current.id);
    branch.push(current);
    if (current.parentId === null || current.parentId === undefined) break;
    if (typeof current.parentId !== "string" || !byId.has(current.parentId)) {
      diagnostics.push({
        message: `missing parent ${String(current.parentId)} for ${current.id}`,
        path,
      });
      break;
    }
    current = byId.get(current.parentId);
  }
  return branch.reverse();
}

function toolCalls(
  message: Record<string, unknown>,
  maxTextChars: number,
  maxToolCalls: number,
): SessionEvidenceToolCall[] {
  return contentBlocks(message)
    .filter(
      (block) =>
        block.type === "toolCall" &&
        typeof block.id === "string" &&
        typeof block.name === "string",
    )
    .slice(0, maxToolCalls)
    .map((block) => ({
      arguments: redactSessionEvidenceValue(block.arguments, maxTextChars),
      id: String(block.id),
      name: String(block.name),
    }));
}

export function readSessionEvidence(
  path: string,
  options: SessionEvidenceReadOptions = {},
): SessionEvidence {
  const maxBytes = Math.max(
    1,
    options.maxBytes ?? Limits.SESSION_EVIDENCE_MAX_BYTES,
  );
  const maxTextChars = Math.max(
    1,
    options.maxTextChars ?? Limits.SESSION_EVIDENCE_TEXT_CHARS,
  );
  const maxToolCalls = Math.max(
    1,
    options.maxToolCalls ?? Limits.SESSION_EVIDENCE_MAX_TOOL_CALLS,
  );
  const maxTurns = Math.max(
    1,
    options.maxTurns ?? Limits.SESSION_EVIDENCE_MAX_TURNS,
  );
  const read = readJsonlFileResilient<SessionEntry>(path, { maxBytes });
  const diagnostics = [...read.diagnostics];
  const header = read.records.find((entry) => entry.type === "session");
  const branch = activeBranch(read.records, path, diagnostics);
  const turns: SessionEvidenceTurn[] = [];
  let pendingUser: { id: string; text?: string } | undefined;
  let currentTurn: SessionEvidenceTurn | undefined;
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const message = asRecord(entry.message);
    const role = message.role;
    if (role === "user") {
      pendingUser = {
        id: String(entry.id),
        text: contentText(message, "text", maxTextChars),
      };
      currentTurn = undefined;
      continue;
    }
    if (role === "assistant") {
      currentTurn = {
        ...(typeof entry.id === "string" ? { assistantEntryId: entry.id } : {}),
        ...(contentText(message, "text", maxTextChars)
          ? { assistantText: contentText(message, "text", maxTextChars) }
          : {}),
        ...(typeof message.errorMessage === "string"
          ? { error: boundedText(message.errorMessage, maxTextChars) }
          : {}),
        index: turns.length + 1,
        ...(typeof message.model === "string" ? { model: message.model } : {}),
        ...(typeof message.provider === "string"
          ? { provider: message.provider }
          : {}),
        ...(typeof message.stopReason === "string"
          ? { stopReason: message.stopReason }
          : {}),
        ...(contentText(message, "thinking", maxTextChars)
          ? { thinking: contentText(message, "thinking", maxTextChars) }
          : {}),
        ...(typeof entry.timestamp === "string"
          ? { timestamp: entry.timestamp }
          : {}),
        toolCalls: toolCalls(message, maxTextChars, maxToolCalls),
        unmatchedToolResults: 0,
        ...(message.usage !== undefined
          ? { usage: redactSessionEvidenceValue(message.usage, maxTextChars) }
          : {}),
        ...(pendingUser
          ? {
              userEntryId: pendingUser.id,
              ...(pendingUser.text ? { userText: pendingUser.text } : {}),
            }
          : {}),
      };
      pendingUser = undefined;
      turns.push(currentTurn);
      continue;
    }
    if (role === "toolResult" && currentTurn) {
      const callId = typeof message.toolCallId === "string" ? message.toolCallId : "";
      const call = currentTurn.toolCalls.find((item) => item.id === callId);
      if (!call) {
        currentTurn.unmatchedToolResults += 1;
        continue;
      }
      call.result = redactSessionEvidenceValue(message.content, maxTextChars);
      call.resultError = message.isError === true;
    }
  }
  if (pendingUser) {
    turns.push({
      index: turns.length + 1,
      toolCalls: [],
      unmatchedToolResults: 0,
      userEntryId: pendingUser.id,
      ...(pendingUser.text ? { userText: pendingUser.text } : {}),
    });
  }
  const firstVisibleIndex = Math.max(0, turns.length - maxTurns);
  const visibleTurns = turns.slice(firstVisibleIndex).map((turn, index) => ({
    ...turn,
    index: firstVisibleIndex + index + 1,
  }));
  return {
    ...(branch.at(-1)?.id ? { activeLeafId: String(branch.at(-1)?.id) } : {}),
    diagnostics,
    path,
    ...(header ? { session: asRecord(header) } : {}),
    totalTurns: turns.length,
    truncated: read.truncated === true || turns.length > visibleTurns.length,
    turns: visibleTurns,
  };
}
