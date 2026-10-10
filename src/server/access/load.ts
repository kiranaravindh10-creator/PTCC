import "server-only";
import { and, eq } from "drizzle-orm";
import type { Executor } from "../db/client";
import { branches, rolePermissions, roles, userRoles, users } from "../db/schema";
import type { Actor } from "./actor";
import { isPermissionKey, type PermissionKey } from "./permissions";
import { isRoleKey, type RoleKey } from "./roles";

/** Builds the Actor for an active user, or null if the user is missing or inactive. */
export async function loadActor(db: Executor, userId: string): Promise<Actor | null> {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      mustChangePassword: users.mustChangePassword,
      branchId: users.branchId,
      branchName: branches.name,
    })
    .from(users)
    .leftJoin(branches, eq(branches.id, users.branchId))
    .where(and(eq(users.id, userId), eq(users.status, "active")))
    .limit(1);
  if (!user) return null;

  const rows = await db
    .select({ roleKey: roles.key, permissionKey: rolePermissions.permissionKey })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const roleKeys = new Set<RoleKey>();
  const permissions = new Set<PermissionKey>();
  for (const row of rows) {
    if (isRoleKey(row.roleKey)) roleKeys.add(row.roleKey);
    if (row.permissionKey && isPermissionKey(row.permissionKey)) permissions.add(row.permissionKey);
  }

  return {
    id: user.id,
    name: user.name,
    roleKeys: [...roleKeys],
    permissions,
    mustChangePassword: user.mustChangePassword,
    branchId: user.branchId,
    branchName: user.branchName,
  };
}
