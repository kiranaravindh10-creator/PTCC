import "server-only";
import { and, count, eq, gte } from "drizzle-orm";
import { normalizePhone } from "@/lib/phone";
import { writeAudit } from "../audit";
import type { RequestMeta } from "../context";
import type { Database } from "../db/client";
import { loginAttempts, users } from "../db/schema";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import { createSession, type NewSession } from "./session";

export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_IDENTIFIER = 5;
export const MAX_FAILURES_PER_IP = 30;

export type SignInResult =
  | ({ ok: true; userId: string } & NewSession)
  | { ok: false; reason: "invalid" | "locked" };

/** Phone numbers are normalised to E.164; emails are lower-cased. */
export function normalizeIdentifier(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (value.includes("@")) return value.toLowerCase();
  return normalizePhone(value);
}

/**
 * Verifies credentials and creates a session.
 * Unknown accounts, wrong passwords and deactivated accounts all return `invalid`
 * with the same timing, so the response never reveals which accounts exist.
 */
export async function signIn(
  db: Database,
  input: { identifier: string; password: string },
  meta: RequestMeta,
  now: Date = new Date(),
): Promise<SignInResult> {
  const identifier = normalizeIdentifier(input.identifier);
  const attemptKey = identifier ?? input.identifier.trim().toLowerCase().slice(0, 200);

  if (await isLockedOut(db, attemptKey, meta.ip, now)) {
    return { ok: false, reason: "locked" };
  }

  const [user] = identifier
    ? await db
        .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
        .from(users)
        .where(identifier.startsWith("+") ? eq(users.phone, identifier) : eq(users.email, identifier))
        .limit(1)
    : [];

  if (!user) {
    await verifyAgainstDummy(input.password);
    await recordFailure(db, attemptKey, meta, now, null);
    return { ok: false, reason: "invalid" };
  }

  const check = await verifyPassword(user.passwordHash, input.password);
  if (!check.valid || user.status !== "active") {
    await recordFailure(db, attemptKey, meta, now, user.id);
    return { ok: false, reason: "invalid" };
  }

  const rehash = check.needsRehash ? await hashPassword(input.password) : null;
  const session = await db.transaction(async (tx) => {
    await tx.insert(loginAttempts).values({ identifier: attemptKey, ip: meta.ip, succeeded: true, createdAt: now });
    await tx
      .update(users)
      .set({ lastLoginAt: now, ...(rehash ? { passwordHash: rehash } : {}) })
      .where(eq(users.id, user.id));
    await writeAudit(tx, { actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id, meta });
    return createSession(tx, user.id, meta, now);
  });

  return { ok: true, userId: user.id, ...session };
}

async function isLockedOut(db: Database, identifier: string, ip: string | null, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
  const [byIdentifier] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, identifier),
        eq(loginAttempts.succeeded, false),
        gte(loginAttempts.createdAt, since),
      ),
    );
  if ((byIdentifier?.n ?? 0) >= MAX_FAILURES_PER_IDENTIFIER) return true;
  if (!ip) return false;
  const [byIp] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.succeeded, false), gte(loginAttempts.createdAt, since)));
  return (byIp?.n ?? 0) >= MAX_FAILURES_PER_IP;
}

async function recordFailure(
  db: Database,
  identifier: string,
  meta: RequestMeta,
  now: Date,
  userId: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(loginAttempts).values({ identifier, ip: meta.ip, succeeded: false, createdAt: now });
    await writeAudit(tx, {
      actorId: null,
      action: "auth.login_failed",
      entityType: userId ? "user" : undefined,
      entityId: userId ?? undefined,
      summary: userId ? undefined : "Unknown account",
      meta,
    });
  });
}
