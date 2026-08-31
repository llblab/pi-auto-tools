import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { mutationLockPath, writeTextAtomic } from "../lib/file-state.ts";
import {
  TRACE_EVENT_MAX_BYTES,
  TRACE_EVENT_MAX_READ,
  TRACE_JOURNAL_MAX_BYTES,
  TRACE_JOURNAL_MAX_EVENTS,
  TRACE_JOURNAL_TARGET_BYTES,
  TRACE_JOURNAL_TARGET_EVENTS,
} from "../lib/limits.ts";
import {
  appendRunTraceEvent,
  readRunTraceEvents,
  readRunTraceJournal,
  runTraceFile,
} from "../lib/runs-trace.ts";

const worker = fileURLToPath(
  new URL("./fixtures/trace-append-worker.ts", import.meta.url),
);

function traceFixture(index: number, payload = ""): Record<string, unknown> {
  return {
    id: `event-${index}`,
    ts: new Date(index).toISOString(),
    kind: "runtime.note",
    ...(payload ? { data: payload } : {}),
  };
}

function encodeFixture(event: Record<string, unknown>): string {
  return `${JSON.stringify(event)}\n`;
}

async function readRawTrace(stateDir: string): Promise<Record<string, unknown>[]> {
  return (await readFile(runTraceFile(stateDir), "utf8"))
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function runTraceWorker(
  stateDir: string,
  workerIndex: number,
  count: number,
  payloadBytes = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        worker,
        stateDir,
        String(workerIndex),
        String(count),
        String(payloadBytes),
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Trace append worker exited ${code}: ${stderr}`));
    });
  });
}

test("Run Trace appends canonical structured events", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-"));
  try {
    const event = appendRunTraceEvent(root, {
      attention: "followup",
      data: { checkpoint: 2 },
      kind: "checkpoint.ready",
      level: "info",
      summary: "Ready for operator review",
    });
    assert.equal(typeof event.id, "string");
    assert.equal(typeof event.ts, "string");
    assert.deepEqual(readRunTraceEvents(root), [event]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace serializes sibling-process appends without loss or corruption", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-stress-"));
  const workerCount = 8;
  const eventsPerWorker = 25;
  try {
    await Promise.all(
      Array.from({ length: workerCount }, (_, index) =>
        runTraceWorker(root, index, eventsPerWorker),
      ),
    );
    const lines = (await readFile(runTraceFile(root), "utf8"))
      .trim()
      .split("\n");
    const records = lines.map((line) => JSON.parse(line));
    assert.equal(records.length, workerCount * eventsPerWorker);
    assert.equal(new Set(records.map((event) => event.id)).size, records.length);
    assert.equal(
      new Set(records.map((event) => `${event.data.worker}:${event.data.index}`)).size,
      records.length,
    );
    assert.equal(records.every((event) => event.kind === "stress.append"), true);
    assert.equal(
      readRunTraceEvents(root, workerCount * eventsPerWorker).length,
      records.length,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace reclaims an abandoned mutation lock before append", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-reclaim-"));
  const lockPath = mutationLockPath(runTraceFile(root));
  try {
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      join(lockPath, "owner.json"),
      JSON.stringify({ pid: Number.MAX_SAFE_INTEGER, token: "abandoned" }),
    );
    await utimes(lockPath, new Date(0), new Date(0));
    const event = appendRunTraceEvent(root, { kind: "runtime.recovered" });
    assert.deepEqual(readRunTraceEvents(root), [event]);
  } finally {
    await rm(lockPath, { force: true, recursive: true });
    await rm(`${lockPath}.reclaim`, { force: true, recursive: true });
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace fails honestly on an unreadable owned journal", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-unreadable-"));
  try {
    await mkdir(runTraceFile(root));
    assert.throws(
      () => appendRunTraceEvent(root, { kind: "runtime.blocked" }),
    );
    assert.deepEqual(await readdir(runTraceFile(root)), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace rejects addressed-message fields and malformed values", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-"));
  try {
    assert.throws(
      () => appendRunTraceEvent(root, { kind: "checkpoint.ready", to: "coordinator" } as never),
      /fields are removed: to/,
    );
    assert.throws(
      () => appendRunTraceEvent(root, { kind: "Checkpoint Ready" }),
      /lowercase semantic token/,
    );
    assert.equal(appendRunTraceEvent(root, {
      attention: "steer",
      kind: "checkpoint.blocked",
      summary: "Approval required",
    }).attention, "steer");
    assert.throws(
      () => appendRunTraceEvent(root, { attention: "broadcast", kind: "checkpoint.ready" } as never),
      /attention must be notify, followup, or steer/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace rejects cyclic and oversized data", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-"));
  try {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(
      () => appendRunTraceEvent(root, { data: cyclic, kind: "runtime.note" }),
      /JSON-serializable/,
    );
    assert.throws(
      () =>
        appendRunTraceEvent(root, {
          data: "x".repeat(TRACE_EVENT_MAX_BYTES),
          kind: "runtime.note",
        }),
      /exceeds 65536 bytes/,
    );
    const retained = appendRunTraceEvent(root, { kind: "runtime.valid" });
    assert.deepEqual(readRunTraceEvents(root), [retained]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace reads a bounded resilient tail", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-"));
  try {
    const events = Array.from({ length: TRACE_EVENT_MAX_READ + 5 }, (_, index) => ({
      id: `event-${index}`,
      kind: "runtime.note",
      ts: new Date(index).toISOString(),
    }));
    await writeFile(
      runTraceFile(root),
      `{bad json}\n${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );
    const read = readRunTraceEvents(root, TRACE_EVENT_MAX_READ + 100);
    assert.equal(read.length, TRACE_EVENT_MAX_READ);
    assert.equal(read[0]?.id, "event-5");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace reader bounds legacy I/O and preserves complete UTF-8 suffix records", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-read-bound-"));
  try {
    const prefix = Buffer.alloc(TRACE_JOURNAL_MAX_BYTES + 37, 0x61);
    const suffix = [
      traceFixture(1, "first λ"),
      traceFixture(2, "second 🙂"),
    ].map(encodeFixture).join("");
    await writeFile(
      runTraceFile(root),
      Buffer.concat([prefix, Buffer.from(`\n${suffix}`, "utf8")]),
    );
    const read = readRunTraceJournal(root);
    assert.equal(read.readBytes, TRACE_JOURNAL_MAX_BYTES);
    assert.equal(read.omittedPrefixBytes, prefix.length + 1);
    assert.deepEqual(read.events.map(({ event }) => event.id), ["event-1", "event-2"]);
    assert.deepEqual(read.events.map(({ ordinal }) => ordinal), [2, 3]);
    assert.equal((read.events[1]?.event.data as string), "second 🙂");
    assert.match(read.diagnostics[0]?.message ?? "", /partial leading/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace compacts event pressure to one exact bounded marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-count-"));
  try {
    await writeFile(
      runTraceFile(root),
      Array.from({ length: TRACE_JOURNAL_MAX_EVENTS }, (_, index) =>
        encodeFixture(traceFixture(index))).join(""),
    );
    const appended = appendRunTraceEvent(root, { kind: "runtime.appended" });
    const records = await readRawTrace(root);
    const marker = records.at(-1)!;
    const data = marker.data as Record<string, unknown>;
    assert.equal(records.length, TRACE_JOURNAL_TARGET_EVENTS);
    assert.equal(records.at(-2)?.id, appended.id);
    assert.equal(records.filter(({ id }) => id === appended.id).length, 1);
    assert.equal(records[0]?.id, `event-${TRACE_JOURNAL_MAX_EVENTS - TRACE_JOURNAL_TARGET_EVENTS + 2}`);
    assert.equal(marker.kind, "runtime.trace_compacted");
    assert.equal(marker.level, "warning");
    assert.equal(Object.hasOwn(marker, "attention"), false);
    assert.equal(data.compactions_total, 1);
    assert.equal(
      data.dropped_valid_events_total,
      TRACE_JOURNAL_MAX_EVENTS - TRACE_JOURNAL_TARGET_EVENTS + 2,
    );
    assert.equal(data.dropped_event_count_exact, true);
    assert.equal(data.retained_events, records.length);
    assert.equal(data.retained_bytes, (await stat(runTraceFile(root))).size);
    assert.ok((await stat(runTraceFile(root))).size <= TRACE_JOURNAL_TARGET_BYTES);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace compacts byte pressure and admits one near-limit event", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-bytes-"));
  try {
    const payload = "x".repeat(63_000);
    const lines: string[] = [];
    let index = 0;
    let bytes = 0;
    while (bytes < TRACE_JOURNAL_MAX_BYTES - 70_000) {
      const line = encodeFixture(traceFixture(index++, payload));
      lines.push(line);
      bytes += Buffer.byteLength(line);
    }
    assert.ok(bytes < TRACE_JOURNAL_MAX_BYTES);
    await writeFile(runTraceFile(root), lines.join(""));
    const appended = appendRunTraceEvent(root, {
      data: "y".repeat(60_000),
      kind: "runtime.large",
    });
    const records = await readRawTrace(root);
    const marker = records.at(-1)!;
    assert.equal(records.at(-2)?.id, appended.id);
    assert.equal(records.filter(({ id }) => id === appended.id).length, 1);
    assert.equal(marker.kind, "runtime.trace_compacted");
    assert.ok(Number((marker.data as Record<string, unknown>).dropped_bytes_total) > 0);
    assert.ok((await stat(runTraceFile(root))).size <= TRACE_JOURNAL_TARGET_BYTES);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace compaction removes malformed lines and accumulates prior statistics", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-cumulative-"));
  try {
    await writeFile(
      runTraceFile(root),
      `{bad json}\n${encodeFixture(traceFixture(0))}`,
    );
    appendRunTraceEvent(root, { kind: "runtime.first" });
    const first = await readRawTrace(root);
    const firstData = first.at(-1)?.data as Record<string, unknown>;
    assert.equal(firstData.dropped_malformed_lines_total, 1);
    assert.equal(firstData.compactions_total, 1);
    const added = Array.from(
      { length: TRACE_JOURNAL_MAX_EVENTS - first.length },
      (_, index) => encodeFixture(traceFixture(10_000 + index)),
    ).join("");
    await writeFile(runTraceFile(root), `${await readFile(runTraceFile(root), "utf8")}${added}`);
    appendRunTraceEvent(root, { kind: "runtime.second" });
    const second = await readRawTrace(root);
    const secondData = second.at(-1)?.data as Record<string, unknown>;
    assert.equal(secondData.compactions_total, 2);
    assert.equal(secondData.dropped_malformed_lines_total, 1);
    assert.ok(
      Number(secondData.dropped_valid_events_total) >
        Number(firstData.dropped_valid_events_total),
    );
    assert.equal(second.filter(({ kind }) => kind === "runtime.trace_compacted").length, 1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace recovers an oversized legacy suffix without loading its prefix", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-legacy-"));
  try {
    const payload = "z".repeat(62_000);
    const lines: string[] = [];
    let bytes = 0;
    for (let index = 0; bytes <= TRACE_JOURNAL_MAX_BYTES; index += 1) {
      const line = encodeFixture(traceFixture(index, payload));
      lines.push(line);
      bytes += Buffer.byteLength(line);
    }
    await writeFile(runTraceFile(root), lines.join(""));
    const originalBytes = (await stat(runTraceFile(root))).size;
    assert.ok(originalBytes > TRACE_JOURNAL_MAX_BYTES);
    const appended = appendRunTraceEvent(root, { kind: "runtime.recovered" });
    const records = await readRawTrace(root);
    const marker = records.at(-1)!;
    const data = marker.data as Record<string, unknown>;
    assert.equal(records.at(-2)?.id, appended.id);
    assert.equal(data.dropped_event_count_exact, false);
    assert.ok(Number(data.dropped_malformed_lines_total) >= 1);
    assert.ok(Number(data.dropped_bytes_total) >= originalBytes - TRACE_JOURNAL_MAX_BYTES);
    assert.ok((await stat(runTraceFile(root))).size <= TRACE_JOURNAL_TARGET_BYTES);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace accepts one maximum-sized canonical event", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-maximum-"));
  try {
    const fixed = JSON.stringify({
      id: "x".repeat(36),
      ts: new Date(0).toISOString(),
      kind: "runtime.maximum",
      data: "",
    });
    const payloadBytes = TRACE_EVENT_MAX_BYTES - Buffer.byteLength(fixed);
    const event = appendRunTraceEvent(root, {
      data: "x".repeat(payloadBytes),
      kind: "runtime.maximum",
    });
    assert.equal(
      Buffer.byteLength(JSON.stringify(event)),
      TRACE_EVENT_MAX_BYTES,
    );
    assert.equal((await stat(runTraceFile(root))).size, TRACE_EVENT_MAX_BYTES + 1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Atomic Trace replacement failure preserves the previous journal", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-atomic-"));
  const path = runTraceFile(root);
  try {
    await writeFile(path, "previous\n");
    assert.throws(
      () => writeTextAtomic(path, "replacement\n", {
        onBeforeReplace: () => { throw new Error("injected replacement failure"); },
      }),
      /injected replacement failure/,
    );
    assert.equal(await readFile(path, "utf8"), "previous\n");
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.endsWith(".tmp")),
      [],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run Trace sibling writers preserve the newest suffix across repeated mixed pressure", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-trace-compact-stress-"));
  const workers = 4;
  const perWorker = 600;
  try {
    await writeFile(
      runTraceFile(root),
      `{bad json}\n${Array.from({ length: TRACE_JOURNAL_MAX_EVENTS }, (_, index) =>
        encodeFixture(traceFixture(index))).join("")}`,
    );
    await Promise.all(
      Array.from({ length: workers }, (_, index) =>
        runTraceWorker(root, index, perWorker, index % 2 ? 0 : 10_000)),
    );
    const records = await readRawTrace(root);
    const marker = records.find(({ kind }) => kind === "runtime.trace_compacted")!;
    const data = marker.data as Record<string, unknown>;
    const workerEvents = records.filter(({ kind }) => kind === "stress.append");
    assert.equal(new Set(workerEvents.map(({ id }) => id)).size, workerEvents.length);
    assert.equal(records.filter(({ kind }) => kind === "runtime.trace_compacted").length, 1);
    assert.ok(Number(data.compactions_total) >= 2);
    assert.ok(Number(data.dropped_valid_events_total) > 0);
    assert.equal(data.dropped_malformed_lines_total, 1);
    assert.equal(data.dropped_event_count_exact, true);
    assert.ok(Number(data.retained_events) <= records.length);
    assert.ok(Number(data.retained_bytes) <= (await stat(runTraceFile(root))).size);
    assert.ok(records.length <= TRACE_JOURNAL_MAX_EVENTS);
    assert.ok((await stat(runTraceFile(root))).size <= TRACE_JOURNAL_MAX_BYTES);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
