import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import * as Limits from "../lib/limits.ts";
import {
  admitRunCompletionBatch,
  admitRunSteerEnvelope,
  finalizeRunCompletionBatch,
  finalizeRunSteer,
  formatRunCompletionBatchMessage,
  getRunDeliveryJournalPath,
  getRunSteerDeliveryId,
  markRunCompletionBatchPresented,
  markRunCompletionBatchQueued,
  markRunSteerPresented,
  markRunSteerQueued,
  readRunDeliveryJournal,
  recordRunCompletionBatchDeliveryFailure,
  recordRunSteerDeliveryFailure,
  resetRunCompletionBatchPending,
  resetRunSteerPending,
  type RunCompletionBatchMember,
} from "../lib/run-delivery.ts";

function member(
  run: string,
  generation = `generation-${run}`,
): RunCompletionBatchMember {
  return {
    artifacts: { report: `/tmp/${run}/report.md` },
    run,
    run_instance_id: generation,
    state_dir: `/tmp/runs/${run}`,
    status: "done",
    summary: `Run ${run} completed`,
    terminal_at: "2026-08-31T12:00:00.000Z",
  };
}

test("Run delivery paths hide exact owner identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-delivery-"));
  try {
    const owner = "session/owner:private";
    const first = getRunDeliveryJournalPath(root, owner);
    assert.equal(first, getRunDeliveryJournalPath(root, owner));
    assert.equal(first.includes(owner), false);
    assert.match(first, /delivery[/\\][0-9a-f]{64}[/\\]projection\.json$/);
    assert.notEqual(first, getRunDeliveryJournalPath(root, `${owner}-other`));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run delivery admits one exact owner-fenced completion batch", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-delivery-"));
  try {
    const batch = admitRunCompletionBatch({
      batchId: "batch-a",
      members: [member("a"), { ...member("b"), status: "failed" }],
      now: new Date("2026-08-31T12:01:00.000Z"),
      ownerId: "session-a",
      tempDir: root,
    });
    assert.equal(batch.phase, "pending");
    assert.deepEqual(batch.members.map((item) => [item.run, item.status]), [
      ["a", "done"],
      ["b", "failed"],
    ]);
    assert.deepEqual(readRunDeliveryJournal(root, "session-a"), {
      completion_batch: batch,
      owner_id: "session-a",
      receipts: [],
      schema: "run-delivery-v1",
      steers: [],
    });
    assert.throws(
      () => admitRunCompletionBatch({
        batchId: "batch-b",
        members: [member("c")],
        ownerId: "session-a",
        tempDir: root,
      }),
      /already has an active completion batch/,
    );
    await writeFile(
      getRunDeliveryJournalPath(root, "session-a"),
      `${JSON.stringify({
        ...readRunDeliveryJournal(root, "session-a"),
        owner_id: "session-b",
      })}\n`,
      "utf8",
    );
    assert.throws(
      () => readRunDeliveryJournal(root, "session-a"),
      /owner does not match/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run delivery phases are monotonic fenced and idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-delivery-"));
  try {
    admitRunCompletionBatch({
      batchId: "batch-a",
      members: [member("a")],
      ownerId: "session-a",
      tempDir: root,
    });
    assert.equal(markRunCompletionBatchPresented({
      batchId: "batch-a",
      ownerId: "session-a",
      tempDir: root,
    }), false);
    assert.equal(markRunCompletionBatchQueued({
      batchId: "missing",
      ownerId: "session-a",
      tempDir: root,
    }), false);
    assert.equal(markRunCompletionBatchQueued({
      batchId: "batch-a",
      now: new Date("2026-08-31T12:02:00.000Z"),
      ownerId: "session-a",
      tempDir: root,
    }), true);
    assert.equal(markRunCompletionBatchQueued({
      batchId: "batch-a",
      now: new Date("2026-08-31T12:03:00.000Z"),
      ownerId: "session-a",
      tempDir: root,
    }), true);
    assert.equal(
      readRunDeliveryJournal(root, "session-a").completion_batch?.queued_at,
      "2026-08-31T12:02:00.000Z",
    );
    assert.equal(markRunCompletionBatchPresented({
      batchId: "batch-a",
      now: new Date("2026-08-31T12:04:00.000Z"),
      ownerId: "session-a",
      tempDir: root,
    }), true);
    assert.equal(finalizeRunCompletionBatch({
      batchId: "batch-a",
      ownerId: "session-a",
      tempDir: root,
    }), true);
    assert.equal(finalizeRunCompletionBatch({
      batchId: "batch-a",
      ownerId: "session-a",
      tempDir: root,
    }), true);
    assert.deepEqual(readRunDeliveryJournal(root, "session-a"), {
      owner_id: "session-a",
      receipts: [{
        delivery_id: "batch-a",
        kind: "completion_batch",
        presented_at: "2026-08-31T12:04:00.000Z",
      }],
      schema: "run-delivery-v1",
      steers: [],
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run delivery preserves bounded send failure and queued recovery evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-delivery-"));
  try {
    admitRunCompletionBatch({
      batchId: "batch-recovery",
      members: [member("a")],
      ownerId: "session-a",
      tempDir: root,
    });
    assert.equal(recordRunCompletionBatchDeliveryFailure({
      batchId: "batch-recovery",
      error: new Error(`send failed ${"detail ".repeat(1_000)}`),
      now: new Date("2026-08-31T12:01:00.000Z"),
      ownerId: "session-a",
      tempDir: root,
    }), true);
    let batch = readRunDeliveryJournal(root, "session-a").completion_batch;
    assert.equal(batch?.attempts, 1);
    assert.equal((batch?.last_error?.length ?? 0) <= 4_096, true);
    assert.equal(batch?.last_failed_at, "2026-08-31T12:01:00.000Z");
    markRunCompletionBatchQueued({
      batchId: "batch-recovery",
      ownerId: "session-a",
      tempDir: root,
    });
    assert.equal(resetRunCompletionBatchPending({
      batchId: "batch-recovery",
      ownerId: "session-a",
      tempDir: root,
    }), true);
    batch = readRunDeliveryJournal(root, "session-a").completion_batch;
    assert.equal(batch?.phase, "pending");
    assert.equal(batch?.queued_at, undefined);
    assert.equal(batch?.attempts, 1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run delivery formats bounded model-facing completion rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-delivery-"));
  try {
    const members = Array.from(
      { length: Limits.RUN_DELIVERY_BATCH_MAX_MEMBERS },
      (_, index) => ({
        ...member(`run-${String(index).padStart(3, "0")}`),
        status: index % 2 === 0 ? "done" as const : "failed" as const,
        summary: `Completed row ${index} ${"detail ".repeat(100)}`,
      }),
    );
    const batch = admitRunCompletionBatch({
      batchId: "batch-model",
      members,
      ownerId: "session-a",
      tempDir: root,
    });
    const message = formatRunCompletionBatchMessage(batch);
    assert.match(message, /^Actor completions: 256\nBatch: `batch-model`/);
    assert.match(message, /Statuses: `done=128 failed=128`/);
    assert.match(message, /more completion\(s\) retained in batch\.$/);
    assert.equal(
      message.split("\n").filter((line) => line.startsWith("- `")).length <=
        Limits.RUN_DELIVERY_MODEL_MAX_MEMBERS,
      true,
    );
    assert.equal(
      Buffer.byteLength(message, "utf8") <= Limits.RUN_DELIVERY_MODEL_MAX_BYTES,
      true,
    );
    assert.equal(
      readRunDeliveryJournal(root, "session-a").completion_batch?.members.length,
      Limits.RUN_DELIVERY_BATCH_MAX_MEMBERS,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run delivery rejects invalid duplicate and excessive members", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-delivery-"));
  try {
    assert.throws(
      () => admitRunCompletionBatch({
        members: [],
        ownerId: "session-a",
        tempDir: root,
      }),
      /non-empty array/,
    );
    assert.throws(
      () => admitRunCompletionBatch({
        members: [member("a"), member("other", "generation-a")].map((item) => ({
          ...item,
          state_dir: "/tmp/runs/a",
        })),
        ownerId: "session-a",
        tempDir: root,
      }),
      /duplicate generation/,
    );
    assert.throws(
      () => admitRunCompletionBatch({
        members: [{ ...member("a"), status: "cancelled" as "done" }],
        ownerId: "session-a",
        tempDir: root,
      }),
      /status is invalid/,
    );
    assert.throws(
      () => admitRunCompletionBatch({
        members: Array.from(
          { length: Limits.RUN_DELIVERY_BATCH_MAX_MEMBERS + 1 },
          (_, index) => member(`run-${index}`),
        ),
        ownerId: "session-a",
        tempDir: root,
      }),
      /member limit/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run delivery fails closed on malformed oversized and symlinked state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-delivery-"));
  try {
    const path = getRunDeliveryJournalPath(root, "session-a");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{broken", "utf8");
    assert.throws(() => readRunDeliveryJournal(root, "session-a"), /malformed/);
    await writeFile(path, JSON.stringify({
      owner_id: "session-a",
      receipts: [],
      schema: "run-delivery-v1",
      steers: null,
    }), "utf8");
    assert.throws(
      () => readRunDeliveryJournal(root, "session-a"),
      /urgent steers are invalid/,
    );
    await writeFile(path, "x".repeat(Limits.RUN_DELIVERY_JOURNAL_MAX_BYTES + 1), "utf8");
    assert.throws(() => readRunDeliveryJournal(root, "session-a"), /bounded regular file/);
    if (process.platform === "win32") {
      t.diagnostic("symbolic-link fixture requires elevated Windows privileges");
      return;
    }
    await rm(path, { force: true });
    const target = join(root, "foreign.json");
    await writeFile(target, "{}\n", "utf8");
    await symlink(target, path);
    assert.throws(() => readRunDeliveryJournal(root, "session-a"), /symbolic link/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run delivery durably fences urgent steer phases and receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-delivery-"));
  try {
    const identity = {
      eventId: "event-a",
      runInstanceId: "generation-a",
      stateDir: "/tmp/runs/a",
    };
    const steerId = getRunSteerDeliveryId(identity);
    const admitted = admitRunSteerEnvelope({
      content: "Run a requires approval.",
      ...identity,
      kind: "checkpoint.blocked",
      level: "warning",
      now: new Date("2026-08-31T12:00:00.000Z"),
      occurredAt: "2026-08-31T11:59:00.000Z",
      ownerId: "session-a",
      run: "a",
      tempDir: root,
    });
    assert.equal(admitted?.steer_id, steerId);
    assert.equal(admitRunSteerEnvelope({
      content: "Run a requires approval.",
      ...identity,
      kind: "checkpoint.blocked",
      level: "warning",
      occurredAt: "2026-08-31T11:59:00.000Z",
      ownerId: "session-a",
      run: "a",
      tempDir: root,
    })?.steer_id, steerId);
    assert.equal(recordRunSteerDeliveryFailure({
      error: new Error("send failed"),
      ownerId: "session-a",
      steerId,
      tempDir: root,
    }), true);
    assert.equal(markRunSteerQueued({
      ownerId: "session-a",
      steerId,
      tempDir: root,
    }), true);
    assert.equal(resetRunSteerPending({
      ownerId: "session-a",
      steerId,
      tempDir: root,
    }), true);
    assert.equal(markRunSteerQueued({
      ownerId: "session-a",
      steerId,
      tempDir: root,
    }), true);
    assert.equal(markRunSteerPresented({
      now: new Date("2026-08-31T12:02:00.000Z"),
      ownerId: "session-a",
      steerId,
      tempDir: root,
    }), true);
    assert.equal(finalizeRunSteer({
      ownerId: "session-a",
      steerId,
      tempDir: root,
    }), true);
    const journal = readRunDeliveryJournal(root, "session-a");
    assert.deepEqual(journal.steers, []);
    assert.deepEqual(journal.receipts, [{
      delivery_id: steerId,
      kind: "urgent_steer",
      presented_at: "2026-08-31T12:02:00.000Z",
    }]);
    assert.equal(admitRunSteerEnvelope({
      content: "Run a requires approval.",
      ...identity,
      kind: "checkpoint.blocked",
      level: "warning",
      occurredAt: "2026-08-31T11:59:00.000Z",
      ownerId: "session-a",
      run: "a",
      tempDir: root,
    }), undefined);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run delivery keeps urgent steer capacity explicit and retryable", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-delivery-"));
  try {
    for (let index = 0; index < Limits.RUN_DELIVERY_STEER_MAX_ENVELOPES; index += 1) {
      admitRunSteerEnvelope({
        content: `Steer ${index}`,
        eventId: `event-${index}`,
        kind: "checkpoint.blocked",
        level: "warning",
        occurredAt: "2026-08-31T11:59:00.000Z",
        ownerId: "session-a",
        run: `run-${index}`,
        runInstanceId: `generation-${index}`,
        stateDir: `/tmp/runs/${index}`,
        tempDir: root,
      });
    }
    assert.throws(() => admitRunSteerEnvelope({
      content: "Overflow",
      eventId: "event-overflow",
      kind: "checkpoint.blocked",
      level: "warning",
      occurredAt: "2026-08-31T11:59:00.000Z",
      ownerId: "session-a",
      run: "overflow",
      runInstanceId: "generation-overflow",
      stateDir: "/tmp/runs/overflow",
      tempDir: root,
    }), (error: unknown) =>
      (error as NodeJS.ErrnoException).code === "RUN_STEER_CAPACITY");
    assert.equal(
      readRunDeliveryJournal(root, "session-a").steers.length,
      Limits.RUN_DELIVERY_STEER_MAX_ENVELOPES,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Run delivery receipts retain one bounded newest tail", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-actors-delivery-"));
  try {
    const count = Limits.RUN_DELIVERY_RECEIPT_LIMIT + 2;
    for (let index = 0; index < count; index += 1) {
      const batchId = `batch-${index}`;
      admitRunCompletionBatch({
        batchId,
        members: [member(`run-${index}`)],
        ownerId: "session-a",
        tempDir: root,
      });
      markRunCompletionBatchQueued({
        batchId,
        ownerId: "session-a",
        tempDir: root,
      });
      markRunCompletionBatchPresented({
        batchId,
        ownerId: "session-a",
        tempDir: root,
      });
      finalizeRunCompletionBatch({
        batchId,
        ownerId: "session-a",
        tempDir: root,
      });
    }
    const receipts = readRunDeliveryJournal(root, "session-a").receipts;
    assert.equal(receipts.length, Limits.RUN_DELIVERY_RECEIPT_LIMIT);
    assert.equal(receipts[0].delivery_id, "batch-2");
    assert.equal(receipts.at(-1)?.delivery_id, `batch-${count - 1}`);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
