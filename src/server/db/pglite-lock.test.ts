import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquirePgliteLock, lockPathFor, pgliteLockHolder, STALE_AFTER_MS } from "./pglite-lock";

let dir: string;
let dataDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ptcc-lock-"));
  dataDir = path.join(dir, "pglite");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// A pid that is certainly alive and not ours: the test runner's parent process.
const otherLivePid = process.ppid;

describe("PGlite lock", () => {
  it("is free when there is no lock file", () => {
    expect(pgliteLockHolder(dataDir)).toBeNull();
  });

  it("blocks while another live process keeps its heartbeat fresh", () => {
    fs.writeFileSync(lockPathFor(dataDir), String(otherLivePid));
    expect(pgliteLockHolder(dataDir)).toBe(otherLivePid);
    expect(() => acquirePgliteLock(dataDir)).toThrow(/in use by another process/);
  });

  it("treats a lock as stale once its heartbeat stops, even if the pid was reused", () => {
    fs.writeFileSync(lockPathFor(dataDir), String(otherLivePid));
    const later = Date.now() + STALE_AFTER_MS + 1000;
    expect(pgliteLockHolder(dataDir, later)).toBeNull();
  });

  it("can be taken and released by this process", () => {
    const release = acquirePgliteLock(dataDir);
    expect(fs.readFileSync(lockPathFor(dataDir), "utf8")).toBe(String(process.pid));
    expect(pgliteLockHolder(dataDir)).toBeNull(); // our own lock never blocks us
    release();
    expect(fs.existsSync(lockPathFor(dataDir))).toBe(false);
  });
});
