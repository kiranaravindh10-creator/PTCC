import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { requirePermission } from "@/server/access/actor";
import { COMPANY_LEVEL_ROLES, isRoleKey, type RoleKey } from "@/server/access/roles";
import { diff, writeAudit } from "@/server/audit";
import {
  generateTemporaryPassword,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "@/server/auth/password";
import { deleteUserSessions } from "@/server/auth/session";
import type { Ctx } from "@/server/context";
import type { Transaction } from "@/server/db/client";
import { branches, rolePermissions, roles, sessions, userRoles, users } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { optionalEmail, optionalText, parseInput, requiredPhone, requiredText, uuidField } from "@/server/validation";
import { formatPhone } from "@/lib/phone";

/** Administration of people and their access (`user.manage`), plus self-service password change. */

const roleKeysField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]))
  .pipe(
    z
      .array(z.string().refine(isRoleKey, "Unknown role."))
      .min(1, "Choose at least one role."),
  );

const personSchema = z.object({
  name: requiredText(120, "Enter the person's name."),
  phone: requiredPhone,
  email: optionalEmail,
  designation: optionalText(120),
  roleKeys: roleKeysField,
  /** Home branch. "" = none, allowed only for company-level roles (CEO, Admin). */
  branchId: z.string().trim().optional(),
});

export type PersonInput = z.input<typeof personSchema>;

export async function createPerson(ctx: Ctx, input: PersonInput): Promise<{ id: string; temporaryPassword: string }> {
  requirePermission(ctx.actor, "user.manage");
  const data = parseInput(personSchema, input);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  return ctx.db.transaction(async (tx) => {
    await assertContactDetailsFree(tx, data.phone, data.email ?? null);
    const branchId = await resolvePersonBranch(tx, data.branchId, data.roleKeys);
    const [user] = await tx
      .insert(users)
      .values({
        name: data.name,
        phone: data.phone,
        email: data.email ?? null,
        designation: data.designation ?? null,
        branchId,
        passwordHash,
        mustChangePassword: true,
        createdBy: ctx.actor.id,
        updatedBy: ctx.actor.id,
      })
      .returning({ id: users.id });
    await setRoles(tx, user!.id, data.roleKeys, ctx.actor.id);
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "user.create",
      entityType: "user",
      entityId: user!.id,
      summary: `Added ${data.name} (${data.roleKeys.join(", ")})`,
      meta: ctx.meta,
    });
    return { id: user!.id, temporaryPassword };
  });
}

export async function updatePerson(ctx: Ctx, input: PersonInput & { id: string }): Promise<void> {
  requirePermission(ctx.actor, "user.manage");
  const id = parseInput(uuidField, input.id);
  const data = parseInput(personSchema, input);

  await ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, id)).for("update").limit(1);
    if (!before) throw new NotFoundError();
    await assertContactDetailsFree(tx, data.phone, data.email ?? null, id);

    if (id === ctx.actor.id && !(await rolesGrantUserManage(tx, data.roleKeys))) {
      throw new ValidationError("You can't remove your own access to People & access.", {
        roleKeys: "Keep a role that lets you manage people, or ask another admin to change this.",
      });
    }

    const after = {
      name: data.name,
      phone: data.phone,
      email: data.email ?? null,
      designation: data.designation ?? null,
      branchId: await resolvePersonBranch(tx, data.branchId, data.roleKeys),
    };
    await tx.update(users).set({ ...after, updatedBy: ctx.actor.id }).where(eq(users.id, id));
    const roleChange = await setRoles(tx, id, data.roleKeys, ctx.actor.id);

    const changes = diff(
      { name: before.name, phone: before.phone, email: before.email, designation: before.designation, branchId: before.branchId },
      after,
    );
    if (roleChange) changes.roles = roleChange;
    if (Object.keys(changes).length > 0) {
      await writeAudit(tx, {
        actorId: ctx.actor.id,
        action: roleChange ? "user.roles_changed" : "user.update",
        entityType: "user",
        entityId: id,
        summary: `Updated ${data.name}`,
        changes,
        meta: ctx.meta,
      });
    }
  });
}

export async function setPersonStatus(ctx: Ctx, input: { id: string; status: "active" | "inactive" }): Promise<void> {
  requirePermission(ctx.actor, "user.manage");
  const id = parseInput(uuidField, input.id);
  const status = parseInput(z.enum(["active", "inactive"]), input.status);
  if (id === ctx.actor.id) throw new ConflictError("You can't deactivate your own account.");

  await ctx.db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ status, updatedBy: ctx.actor.id })
      .where(eq(users.id, id))
      .returning({ name: users.name });
    if (!user) throw new NotFoundError();
    // Deactivation signs the person out everywhere, immediately.
    if (status === "inactive") await deleteUserSessions(tx, id);
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: status === "inactive" ? "user.deactivate" : "user.reactivate",
      entityType: "user",
      entityId: id,
      summary: `${status === "inactive" ? "Deactivated" : "Reactivated"} ${user.name}`,
      meta: ctx.meta,
    });
  });
}

export async function resetPersonPassword(ctx: Ctx, input: { id: string }): Promise<{ temporaryPassword: string }> {
  requirePermission(ctx.actor, "user.manage");
  const id = parseInput(uuidField, input.id);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await ctx.db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, updatedBy: ctx.actor.id })
      .where(eq(users.id, id))
      .returning({ name: users.name });
    if (!user) throw new NotFoundError();
    await deleteUserSessions(tx, id);
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "user.password_reset",
      entityType: "user",
      entityId: id,
      summary: `Reset password for ${user.name}`,
      meta: ctx.meta,
    });
  });
  return { temporaryPassword };
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z.string().superRefine((value, ctx) => {
      const problem = passwordProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two passwords don't match.",
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from your current one.",
  });

/** Changes the actor's own password and signs out their other sessions. */
export async function changeOwnPassword(
  ctx: Ctx,
  input: z.input<typeof changePasswordSchema>,
  currentSessionId: string | null,
): Promise<void> {
  const data = parseInput(changePasswordSchema, input);
  const [user] = await ctx.db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, ctx.actor.id))
    .limit(1);
  if (!user) throw new NotFoundError();
  const check = await verifyPassword(user.passwordHash, data.currentPassword);
  if (!check.valid) {
    throw new ValidationError("Please check the highlighted fields.", {
      currentPassword: "That isn't your current password.",
    });
  }
  const passwordHash = await hashPassword(data.newPassword);
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: false, updatedBy: ctx.actor.id })
      .where(eq(users.id, ctx.actor.id));
    await tx
      .delete(sessions)
      .where(
        currentSessionId
          ? and(eq(sessions.userId, ctx.actor.id), ne(sessions.id, currentSessionId))
          : eq(sessions.userId, ctx.actor.id),
      );
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "user.password_change",
      entityType: "user",
      entityId: ctx.actor.id,
      meta: ctx.meta,
    });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Everyone works at a branch, except people whose roles are all company-level (CEO, Admin):
 * branch-scoped permissions mean nothing without a home branch.
 */
async function resolvePersonBranch(tx: Transaction, branchId: string | undefined, roleKeys: string[]): Promise<string | null> {
  const companyLevelOnly = roleKeys.every((key) => COMPANY_LEVEL_ROLES.includes(key as RoleKey));
  if (!branchId) {
    if (companyLevelOnly) return null;
    throw new ValidationError("Please check the highlighted fields.", { branchId: "Choose the branch this person works at." });
  }
  const [branch] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.status, "active")))
    .limit(1);
  if (!branch) throw new ValidationError("Please check the highlighted fields.", { branchId: "Choose an active branch." });
  return branch.id;
}

async function assertContactDetailsFree(tx: Transaction, phone: string, email: string | null, exceptUserId?: string) {
  const [phoneOwner] = await tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(exceptUserId ? and(eq(users.phone, phone), ne(users.id, exceptUserId)) : eq(users.phone, phone))
    .limit(1);
  if (phoneOwner) {
    throw new ValidationError("Please check the highlighted fields.", {
      phone: `${formatPhone(phone)} is already used by ${phoneOwner.name}.`,
    });
  }
  if (!email) return;
  const [emailOwner] = await tx
    .select({ name: users.name })
    .from(users)
    .where(exceptUserId ? and(eq(users.email, email), ne(users.id, exceptUserId)) : eq(users.email, email))
    .limit(1);
  if (emailOwner) {
    throw new ValidationError("Please check the highlighted fields.", {
      email: `${email} is already used by ${emailOwner.name}.`,
    });
  }
}

/** Replaces a user's roles. Returns `[before, after]` role keys when something changed. */
async function setRoles(
  tx: Transaction,
  userId: string,
  roleKeys: string[],
  actorId: string,
): Promise<[string[], string[]] | null> {
  const wanted = await tx.select({ id: roles.id, key: roles.key }).from(roles).where(inArray(roles.key, roleKeys));
  if (wanted.length !== new Set(roleKeys).size) {
    throw new ValidationError("Please check the highlighted fields.", { roleKeys: "One of those roles doesn't exist." });
  }
  const current = await tx
    .select({ roleId: userRoles.roleId, key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));

  const toRemove = current.filter((row) => !wanted.some((role) => role.id === row.roleId));
  const toAdd = wanted.filter((role) => !current.some((row) => row.roleId === role.id));
  if (toRemove.length === 0 && toAdd.length === 0) return null;

  if (toRemove.length > 0) {
    await tx.delete(userRoles).where(
      and(
        eq(userRoles.userId, userId),
        inArray(
          userRoles.roleId,
          toRemove.map((row) => row.roleId),
        ),
      ),
    );
  }
  if (toAdd.length > 0) {
    await tx.insert(userRoles).values(toAdd.map((role) => ({ userId, roleId: role.id, assignedBy: actorId })));
  }
  return [current.map((row) => row.key).sort(), wanted.map((role) => role.key).sort()];
}

async function rolesGrantUserManage(tx: Transaction, roleKeys: string[]): Promise<boolean> {
  const [row] = await tx
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .where(and(inArray(roles.key, roleKeys), eq(rolePermissions.permissionKey, "user.manage")))
    .limit(1);
  return Boolean(row);
}
