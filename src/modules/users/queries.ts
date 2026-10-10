import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { canAny, requirePermission } from "@/server/access/actor";
import { ForbiddenError } from "@/server/errors";
import type { Ctx } from "@/server/context";
import { outerId } from "@/server/db/sql";
import { auditLogs, branches, permissions, rolePermissions, roles, userRoles, users, type UserStatus } from "@/server/db/schema";

/**
 * Reads about people and access. Contact details, status and roles of other people
 * are only for `user.manage`; password hashes are never selected here.
 */

export type PersonRow = {
  id: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
  phone: string;
  email: string | null;
  designation: string | null;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  roleKeys: string[];
  roleNames: string[];
};

const personColumns = {
  id: users.id,
  name: users.name,
  branchId: users.branchId,
  branchName: branches.name,
  phone: users.phone,
  email: users.email,
  designation: users.designation,
  status: users.status,
  mustChangePassword: users.mustChangePassword,
  lastLoginAt: users.lastLoginAt,
  roleKeys: sql<string[] | null>`array_remove(array_agg(${roles.key} order by ${roles.name}), null)`,
  roleNames: sql<string[] | null>`array_remove(array_agg(${roles.name} order by ${roles.name}), null)`,
};

function selectPeople(ctx: Pick<Ctx, "db">) {
  return ctx.db
    .select(personColumns)
    .from(users)
    .leftJoin(branches, eq(branches.id, users.branchId))
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .groupBy(users.id, branches.name);
}

type RawPerson = Omit<PersonRow, "roleKeys" | "roleNames"> & { roleKeys: string[] | null; roleNames: string[] | null };

const toPerson = (row: RawPerson): PersonRow => ({
  ...row,
  roleKeys: row.roleKeys ?? [],
  roleNames: row.roleNames ?? [],
});

export async function listPeople(ctx: Pick<Ctx, "db" | "actor">): Promise<PersonRow[]> {
  requirePermission(ctx.actor, "user.manage");
  const rows = await selectPeople(ctx).orderBy(sql`${users.status} = 'inactive'`, asc(branches.name), asc(users.name));
  return rows.map(toPerson);
}

export async function getPerson(ctx: Pick<Ctx, "db" | "actor">, userId: string): Promise<PersonRow | null> {
  requirePermission(ctx.actor, "user.manage");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [row] = await selectPeople(ctx).where(eq(users.id, userId));
  return row ? toPerson(row) : null;
}

export type RoleWithPermissions = {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: { key: string; group: string; description: string }[];
  memberCount: number;
};

export async function listRoles(ctx: Pick<Ctx, "db" | "actor">): Promise<RoleWithPermissions[]> {
  if (!canAny(ctx.actor, "user.manage", "role.manage")) throw new ForbiddenError();
  const roleRows = await ctx.db
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      description: roles.description,
      memberCount: sql<number>`(select count(*)::int from user_roles ur join users u on u.id = ur.user_id
                                where ur.role_id = ${outerId(roles)} and u.status = 'active')`,
    })
    .from(roles)
    .orderBy(asc(roles.name));
  const grants = await ctx.db
    .select({
      roleId: rolePermissions.roleId,
      key: permissions.key,
      group: permissions.groupName,
      description: permissions.description,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.key, rolePermissions.permissionKey))
    .orderBy(asc(permissions.groupName), asc(permissions.key));
  return roleRows.map((role) => ({
    ...role,
    permissions: grants.filter((grant) => grant.roleId === role.id).map(({ key, group, description }) => ({ key, group, description })),
  }));
}

export type AuditItem = {
  id: string;
  action: string;
  actorName: string | null;
  entityType: string | null;
  entityId: string | null;
  summary: string | null;
  ip: string | null;
  createdAt: Date;
};

export async function listAuditLog(ctx: Pick<Ctx, "db" | "actor">, options: { limit?: number } = {}): Promise<AuditItem[]> {
  requirePermission(ctx.actor, "audit.read");
  const actor = alias(users, "actor");
  return ctx.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorName: actor.name,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      summary: auditLogs.summary,
      ip: auditLogs.ip,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(actor, eq(actor.id, auditLogs.actorId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(options.limit ?? 200);
}

/** The signed-in person's own profile. */
export async function getOwnProfile(ctx: Pick<Ctx, "db" | "actor">) {
  const [row] = await selectPeople(ctx).where(eq(users.id, ctx.actor.id));
  return row ? toPerson(row) : null;
}
