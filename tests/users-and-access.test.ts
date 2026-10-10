import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActor } from "@/server/access/load";
import { syncAccess } from "@/server/access/sync";
import { createSession, validateSessionToken } from "@/server/auth/session";
import { signIn } from "@/server/auth/sign-in";
import type { Ctx } from "@/server/context";
import type { DatabaseHandle } from "@/server/db/client";
import { accessDefaultsApplied, rolePermissions, roles } from "@/server/db/schema";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { listPeople, listRoles } from "@/modules/users/queries";
import { changeOwnPassword, createPerson, resetPersonPassword, updatePerson } from "@/modules/users/service";
import { contextFor, createTestBranch, createTestDatabase, createTestUser, TEST_PASSWORD } from "./support/db";

let handle: DatabaseHandle;
let deepa: Ctx; // admin
let rahul: Ctx; // marketing
let branchId: string;
const meta = { ip: "10.0.0.2", userAgent: "vitest" };

beforeAll(async () => {
  handle = await createTestDatabase();
  branchId = await createTestBranch(handle.db, "Bengaluru");
  deepa = await contextFor(handle.db, await createTestUser(handle.db, { name: "Deepa Nair", roles: ["admin"] }));
  rahul = await contextFor(handle.db, await createTestUser(handle.db, { name: "Rahul Menon", roles: ["marketing"] }));
});
afterAll(async () => {
  await handle.close();
});

describe("access catalogue", () => {
  it("combines the permissions of all a person's roles", async () => {
    const id = await createTestUser(handle.db, { roles: ["collection", "hr"] });
    const actor = await loadActor(handle.db, id);
    expect(actor?.roleKeys).toEqual(expect.arrayContaining(["collection", "hr"]));
    expect(actor?.permissions.has("task.assign.branch")).toBe(true); // from hr
    expect(actor?.permissions.has("collection.read.own")).toBe(true); // from collection
    expect(actor?.permissions.has("collection.read.branch")).toBe(true); // from hr
    expect(actor?.permissions.has("user.manage")).toBe(false);
  });

  it("returns no actor for deactivated people", async () => {
    const id = await createTestUser(handle.db, { roles: ["ceo"], status: "inactive" });
    expect(await loadActor(handle.db, id)).toBeNull();
  });

  it("re-syncing never overwrites permissions an admin changed", async () => {
    const [marketing] = await handle.db.select().from(roles).where(eq(roles.key, "marketing"));
    const grantsOf = async () =>
      (await handle.db.select().from(rolePermissions).where(eq(rolePermissions.roleId, marketing!.id))).map((g) => g.permissionKey);

    // An extra grant the admin added stays…
    await handle.db.insert(rolePermissions).values({ roleId: marketing!.id, permissionKey: "team.view.branch" });
    // …and a default the admin removed is not put back.
    await handle.db.delete(rolePermissions).where(eq(rolePermissions.permissionKey, "catalogue.read"));
    const result = await syncAccess(handle.db);
    expect(result.rolesCreated).toEqual([]);
    expect(result.grantsApplied).toBe(0);
    expect(await grantsOf()).toContain("team.view.branch");
    expect(await grantsOf()).not.toContain("catalogue.read");
  });

  it("delivers a new default permission to existing roles exactly once", async () => {
    const [marketing] = await handle.db.select().from(roles).where(eq(roles.key, "marketing"));
    // Simulate a deployment that introduces a default this database has never applied.
    await handle.db.delete(accessDefaultsApplied).where(eq(accessDefaultsApplied.permissionKey, "catalogue.read"));
    const first = await syncAccess(handle.db);
    expect(first.grantsApplied).toBeGreaterThan(0);
    const grants = await handle.db.select().from(rolePermissions).where(eq(rolePermissions.roleId, marketing!.id));
    expect(grants.map((g) => g.permissionKey)).toContain("catalogue.read");
    expect((await syncAccess(handle.db)).grantsApplied).toBe(0);
  });
});

describe("roles overview", () => {
  it("counts each role's active members", async () => {
    const memberCount = async (key: string) => (await listRoles(deepa)).find((role) => role.key === key)!.memberCount;
    const before = await memberCount("accounts");
    await createTestUser(handle.db, { roles: ["accounts"], branchId });
    await createTestUser(handle.db, { roles: ["accounts"], branchId, status: "inactive" }); // not counted
    expect(await memberCount("accounts")).toBe(before + 1);
    expect(await memberCount("admin")).toBeGreaterThanOrEqual(1); // Deepa
  });
});

describe("adding people", () => {
  it("creates an account with a temporary password that must be changed", async () => {
    const { id, temporaryPassword } = await createPerson(deepa, {
      name: "Arun Kumar",
      phone: "98765 43210",
      roleKeys: ["collection"],
      branchId,
    });
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    const result = await signIn(handle.db, { identifier: "9876543210", password: temporaryPassword }, meta);
    expect(result).toMatchObject({ ok: true, userId: id });
    expect((await loadActor(handle.db, id))?.mustChangePassword).toBe(true);
  });

  it("explains duplicate phone numbers on the phone field", async () => {
    const error = await createPerson(deepa, { name: "Someone", phone: "+91 98765 43210", roleKeys: ["accounts"], branchId }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors.phone).toBe("98765 43210 is already used by Arun Kumar.");
  });

  it("requires at least one known role", async () => {
    const error = await createPerson(deepa, { name: "No role", phone: "9811100000", roleKeys: [] }).catch((e) => e);
    expect((error as ValidationError).fieldErrors.roleKeys).toBe("Choose at least one role.");
    await expect(
      createPerson(deepa, { name: "Bad role", phone: "9811100001", roleKeys: ["superuser"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires a branch for everyone except company-level roles", async () => {
    const error = await createPerson(deepa, { name: "No branch", phone: "9811100003", roleKeys: ["marketing"] }).catch((e) => e);
    expect((error as ValidationError).fieldErrors.branchId).toBe("Choose the branch this person works at.");
    const { id } = await createPerson(deepa, { name: "Company admin", phone: "9811100004", roleKeys: ["admin"] });
    expect((await loadActor(handle.db, id))?.branchId).toBeNull();
    const placed = await createPerson(deepa, { name: "Placed", phone: "9811100005", roleKeys: ["hr"], branchId });
    expect((await loadActor(handle.db, placed.id))?.branchName).toBe("Bengaluru");
  });

  it("is only for people with user.manage", async () => {
    await expect(createPerson(rahul, { name: "X", phone: "9811100002", roleKeys: ["marketing"] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listPeople(rahul)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("admin safety rails", () => {
  it("stops an admin removing their own access", async () => {
    const error = await updatePerson(deepa, {
      id: deepa.actor.id,
      name: "Deepa Nair",
      phone: "9800000099",
      roleKeys: ["marketing"],
      branchId,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors.roleKeys).toBeDefined();
  });

  it("resets a password and signs the person out everywhere", async () => {
    const id = await createTestUser(handle.db, { roles: ["accounts"] });
    const { token } = await createSession(handle.db, id, meta);
    const { temporaryPassword } = await resetPersonPassword(deepa, { id });
    expect(await validateSessionToken(handle.db, token)).toBeNull();
    expect((await loadActor(handle.db, id))?.mustChangePassword).toBe(true);
    expect(temporaryPassword.length).toBe(14);
  });
});

describe("changing your own password", () => {
  it("checks the current password, clears the first-sign-in flag and ends other sessions", async () => {
    const id = await createTestUser(handle.db, { roles: ["marketing"], mustChangePassword: true });
    const ctx = await contextFor(handle.db, id);
    const current = await createSession(handle.db, id, meta);
    const other = await createSession(handle.db, id, meta);
    const currentSessionId = (await validateSessionToken(handle.db, current.token))!.sessionId;

    await expect(
      changeOwnPassword(ctx, { currentPassword: "wrong", newPassword: "new password 1", confirmPassword: "new password 1" }, currentSessionId),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      changeOwnPassword(ctx, { currentPassword: TEST_PASSWORD, newPassword: "short", confirmPassword: "short" }, currentSessionId),
    ).rejects.toBeInstanceOf(ValidationError);

    await changeOwnPassword(
      ctx,
      { currentPassword: TEST_PASSWORD, newPassword: "new password 1", confirmPassword: "new password 1" },
      currentSessionId,
    );
    expect((await loadActor(handle.db, id))?.mustChangePassword).toBe(false);
    expect(await validateSessionToken(handle.db, current.token)).not.toBeNull();
    expect(await validateSessionToken(handle.db, other.token)).toBeNull();
  });
});

describe("deactivation", () => {
  it("cannot be applied to yourself", async () => {
    const { setPersonStatus } = await import("@/modules/users/service");
    await expect(setPersonStatus(deepa, { id: deepa.actor.id, status: "inactive" })).rejects.toBeInstanceOf(ConflictError);
  });
});
