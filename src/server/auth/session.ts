import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { RequestMeta } from "../context";
import type { Executor } from "../db/client";
import { sessions } from "../db/schema";

/**
 * Server-side sessions. The random token lives only in the user's HttpOnly cookie;
 * the database stores its SHA-256 hash. Sessions last 30 days and slide forward when
 * fewer than 15 days remain.
 */

export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_WHEN_REMAINING_MS = 15 * 24 * 60 * 60 * 1000;
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type NewSession = { token: string; expiresAt: Date };

export async function createSession(
  db: Executor,
  userId: string,
  meta: RequestMeta,
  now: Date = new Date(),
): Promise<NewSession> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  await db.insert(sessions).values({
    id: hashSessionToken(token),
    userId,
    expiresAt,
    createdAt: now,
    lastSeenAt: now,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 400) ?? null,
  });
  return { token, expiresAt };
}

export type ValidSession = { sessionId: string; userId: string; expiresAt: Date };

/** Returns the session for a token, or null if it is unknown or expired (expired rows are removed). */
export async function validateSessionToken(
  db: Executor,
  token: string,
  now: Date = new Date(),
): Promise<ValidSession | null> {
  if (!token || token.length > 100) return null;
  const sessionId = hashSessionToken(token);
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) return null;

  if (session.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  let expiresAt = session.expiresAt;
  const renew = expiresAt.getTime() - now.getTime() < RENEW_WHEN_REMAINING_MS;
  const touch = now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS;
  if (renew || touch) {
    if (renew) expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    await db.update(sessions).set({ expiresAt, lastSeenAt: now }).where(eq(sessions.id, sessionId));
  }

  return { sessionId, userId: session.userId, expiresAt };
}

export async function deleteSession(db: Executor, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteUserSessions(db: Executor, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
