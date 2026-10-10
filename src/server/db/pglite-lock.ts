import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * PGlite is a single-process database: two processes writing the same directory would
 * corrupt it. This lock turns that mistake (e.g. running `npm run db:seed` while
 * `npm run dev` is running) into a clear error.
 *
 * The holder writes its pid and refreshes the file's modification time every few
 * seconds. A lock counts as held only while that heartbeat is fresh *and* the pid is
 * alive — PIDs are recycled quickly (especially on Windows), so a crashed process's
 * lock must not block forever just because some unrelated process got its pid.
 */

const HEARTBEAT_MS = 5_000;
export const STALE_AFTER_MS = 20_000;

export function lockPathFor(dataDir: string): string {
  return `${dataDir}.lock`;
}

/** The pid of another live process holding the lock, or null if it's free or stale. */
export function pgliteLockHolder(dataDir: string, now: number = Date.now()): number | null {
  const lockPath = lockPathFor(dataDir);
  let modifiedAt: number;
  try {
    modifiedAt = fs.statSync(lockPath).mtimeMs;
  } catch {
    return null; // no lock file
  }
  const holder = readHolder(lockPath);
  if (holder === null || holder === process.pid) return null;
  const heartbeatFresh = now - modifiedAt < STALE_AFTER_MS;
  return heartbeatFresh && isProcessAlive(holder) ? holder : null;
}

/** Takes the lock (or throws if another live process holds it). Returns a release function. */
export function acquirePgliteLock(dataDir: string): () => void {
  const lockPath = lockPathFor(dataDir);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const holder = pgliteLockHolder(dataDir);
  if (holder !== null) {
    throw new Error(
      `The local database (${dataDir}) is in use by another process (pid ${holder}). ` +
        "Stop `npm run dev` (or the other script) and try again.",
    );
  }
  fs.writeFileSync(lockPath, String(process.pid));

  const heartbeat = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(lockPath, now, now);
    } catch {
      // Lock file removed (e.g. db:reset after this process stopped using it) — nothing to refresh.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const release = () => {
    clearInterval(heartbeat);
    if (readHolder(lockPath) === process.pid) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Already removed.
      }
    }
  };
  process.once("exit", release);
  return release;
}

function readHolder(lockPath: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(lockPath, "utf8"), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
