/**
 * Extension temp-directory tests
 * Covers stale cleanup without system tmp coupling
 */

import assert from "node:assert/strict";
import { mkdir, stat, utimes, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupStaleRunEntries,
  cleanupStaleTempEntries,
  prepareExtensionTempDir,
} from "../lib/temp.ts";

test("Extension temp cleanup removes stale files and directories", async () => {
  const root = join(
    tmpdir(),
    `pi-actors-temp-${process.pid}-${Date.now()}`,
  );
  const staleFile = join(root, "old.txt");
  const staleDir = join(root, "old-dir");
  const freshFile = join(root, "fresh.txt");
  const deliveryDir = join(root, "delivery");
  const runsDir = join(root, "runs");
  try {
    await mkdir(staleDir, { recursive: true });
    await mkdir(deliveryDir, { recursive: true });
    await mkdir(runsDir, { recursive: true });
    await writeFile(staleFile, "old");
    await writeFile(join(staleDir, "nested.txt"), "old");
    await writeFile(join(deliveryDir, "projection.json"), "old but protected");
    await writeFile(join(runsDir, "run.json"), "old but protected");
    await writeFile(freshFile, "fresh");
    const now = Date.now();
    const old = new Date(now - 2000);
    await utimes(staleFile, old, old);
    await utimes(staleDir, old, old);
    await utimes(deliveryDir, old, old);
    await utimes(runsDir, old, old);
    const removed = await cleanupStaleTempEntries(root, 1000, now);
    assert.equal(removed, 2);
    await assert.rejects(stat(staleFile));
    await assert.rejects(stat(staleDir));
    assert.equal((await stat(deliveryDir)).isDirectory(), true);
    assert.equal((await stat(runsDir)).isDirectory(), true);
    assert.equal((await stat(freshFile)).isFile(), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Extension temp cleanup removes stale terminal run entries", async () => {
  const root = join(
    tmpdir(),
    `pi-actors-temp-runs-${process.pid}-${Date.now()}`,
  );
  const staleRun = join(root, "stale-run");
  const freshRun = join(root, "fresh-run");
  try {
    await mkdir(staleRun, { recursive: true });
    await mkdir(freshRun, { recursive: true });
    await writeFile(join(staleRun, "run.json"), JSON.stringify({ pid: 0, run: "stale-run" }));
    await writeFile(join(freshRun, "run.json"), JSON.stringify({ pid: 0, run: "fresh-run" }));
    const now = Date.now();
    const old = new Date(now - 8 * 24 * 60 * 60 * 1000);
    await utimes(staleRun, old, old);
    const removed = await cleanupStaleRunEntries(root, 7 * 24 * 60 * 60 * 1000, now);
    assert.equal(removed, 1);
    await assert.rejects(stat(staleRun));
    assert.equal((await stat(freshRun)).isDirectory(), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Extension temp preparation creates directory", async () => {
  const root = join(
    tmpdir(),
    `pi-actors-temp-prepare-${process.pid}-${Date.now()}`,
  );
  try {
    await prepareExtensionTempDir(root);
    assert.equal((await stat(root)).isDirectory(), true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
