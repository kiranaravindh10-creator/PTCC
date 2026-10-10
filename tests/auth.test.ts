import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, SESSION_DURATION_MS, validateSessionToken } from "@/server/auth/session";
import { MAX_FAILURES_PER_IDENTIFIER, signIn } from "@/server/auth/sign-in";
import type { DatabaseHandle } from "@/server/db/client";
import { auditLogs, sessions, users } from "@/server/db/schema";
import { setPersonStatus } from "@/modules/users/service";
import { contextFor, createTestDatabase, createTestUser, TEST_PASSWORD } from "./support/db";

let handle: DatabaseHandle;
const meta = { ip: "10.0.0.1", userAgent: "vitest" };

beforeAll(async () => {
  handle = await createTestDatabase();
});
afterAll(async () => {
  await handle.close();
});

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("a long enough password");
    expect(hash).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect((await verifyPassword(hash, "a long enough password")).valid).toBe(true);
    expect((await verifyPassword(hash, "a long enough passworD")).valid).toBe(false);
  });

  it("flags hashes made with older parameters for re-hashing", async () => {
    // A hash produced with weaker parameters still verifies, but should be upgraded.
    const { scryptSync, randomBytes } = await import("node:crypto");
    const salt = randomBytes(16);
    const key = scryptSync("old password", salt, 64, { N: 1024, r: 8, p: 1 });
    const old = ["scrypt", 1024, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
    expect(await verifyPassword(old, "old password")).toEqual({ valid: true, needsRehash: true });
  });
});

describe("signIn", () => {
  it("accepts the phone number however it is typed, and creates a valid session", async () => {
    const userId = await createTestUser(handle.db, { roles: ["marketing"], phone: "9811112222" });
    const result = await signIn(handle.db, { identifier: "+91 98111-12222", password: TEST_PASSWORD }, meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBe(userId);
    expect(await validateSessionToken(handle.db, result.token)).toMatchObject({ userId });

    // Only the hash of the token is stored.
    const stored = await handle.db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(stored[0]?.id).not.toBe(result.token);
  });

  it("accepts email, case-insensitively", async () => {
    const userId = await createTestUser(handle.db, { roles: ["accounts"] });
    await handle.db.update(users).set({ email: "fathima@ptcc.example" }).where(eq(users.id, userId));
    const result = await signIn(handle.db, { identifier: "Fathima@PTCC.example", password: TEST_PASSWORD }, meta);
    expect(result.ok).toBe(true);
  });

  it("gives the same answer for unknown accounts, wrong passwords and deactivated accounts", async () => {
    await createTestUser(handle.db, { roles: ["collection"], phone: "9822223333" });
    await createTestUser(handle.db, { roles: ["collection"], phone: "9833334444", status: "inactive" });
    const wrong = await signIn(handle.db, { identifier: "9822223333", password: "nope nope" }, meta);
    const unknown = await signIn(handle.db, { identifier: "9899999999", password: TEST_PASSWORD }, meta);
    const inactive = await signIn(handle.db, { identifier: "9833334444", password: TEST_PASSWORD }, meta);
    expect([wrong, unknown, inactive]).toEqual([
      { ok: false, reason: "invalid" },
      { ok: false, reason: "invalid" },
      { ok: false, reason: "invalid" },
    ]);
  });

  it("locks an account after repeated failures, even with the right password", async () => {
    await createTestUser(handle.db, { roles: ["collection"], phone: "9844445555" });
    for (let i = 0; i < MAX_FAILURES_PER_IDENTIFIER; i++) {
      await signIn(handle.db, { identifier: "9844445555", password: `wrong-${i}` }, { ...meta, ip: `10.0.1.${i}` });
    }
    const result = await signIn(handle.db, { identifier: "9844445555", password: TEST_PASSWORD }, meta);
    expect(result).toEqual({ ok: false, reason: "locked" });

    // The lock lifts after the window.
    const later = new Date(Date.now() + 16 * 60 * 1000);
    expect((await signIn(handle.db, { identifier: "9844445555", password: TEST_PASSWORD }, meta, later)).ok).toBe(true);
  });

  it("records sign-ins and failures in the audit log", async () => {
    const actions = await handle.db.select({ action: auditLogs.action }).from(auditLogs);
    expect(actions.map((row) => row.action)).toEqual(expect.arrayContaining(["auth.login", "auth.login_failed"]));
  });
});

describe("sessions", () => {
  it("expire, and slide forward when used in their second half", async () => {
    const userId = await createTestUser(handle.db, { roles: ["marketing"] });
    const start = new Date("2026-10-01T00:00:00Z");
    const { token, expiresAt } = await createSession(handle.db, userId, meta, start);
    expect(expiresAt.getTime() - start.getTime()).toBe(SESSION_DURATION_MS);

    const day20 = new Date(start.getTime() + 20 * 86_400_000);
    const renewed = await validateSessionToken(handle.db, token, day20);
    expect(renewed?.expiresAt.getTime()).toBe(day20.getTime() + SESSION_DURATION_MS);

    const muchLater = new Date(day20.getTime() + SESSION_DURATION_MS + 1000);
    expect(await validateSessionToken(handle.db, token, muchLater)).toBeNull();
  });

  it("are all revoked when a person is deactivated", async () => {
    const adminId = await createTestUser(handle.db, { roles: ["admin"] });
    const userId = await createTestUser(handle.db, { roles: ["collection"] });
    const { token } = await createSession(handle.db, userId, meta);
    await setPersonStatus(await contextFor(handle.db, adminId), { id: userId, status: "inactive" });
    expect(await validateSessionToken(handle.db, token)).toBeNull();
  });
});
