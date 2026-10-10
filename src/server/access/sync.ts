import "server-only";
import { eq, inArray, notInArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { accessDefaultsApplied, permissions, rolePermissions, roles } from "../db/schema";
import { PERMISSIONS, PERMISSION_KEYS } from "./permissions";
import { ROLES, ROLE_KEYS } from "./roles";

export type SyncAccessResult = {
  permissionsUpserted: number;
  permissionsRemoved: number;
  rolesCreated: string[];
  grantsApplied: number;
};

/**
 * Makes the database's permission catalogue and system roles match the code.
 *
 * - Every permission in the code catalogue exists (descriptions updated).
 * - Permissions no longer in the catalogue are removed (and with them, their grants).
 * - Missing system roles are created.
 * - Each default grant (role → permission) is applied exactly once, and remembered in
 *   `access_defaults_applied`. A grant an Admin later removes is not re-added; a new or
 *   renamed permission still reaches existing roles.
 *
 * Idempotent — safe to run on every deployment.
 */
export async function syncAccess(db: Database): Promise<SyncAccessResult> {
  return db.transaction(async (tx) => {
    for (const key of PERMISSION_KEYS) {
      const { group, description } = PERMISSIONS[key];
      await tx
        .insert(permissions)
        .values({ key, groupName: group, description })
        .onConflictDoUpdate({ target: permissions.key, set: { groupName: group, description } });
    }

    const removed = await tx
      .delete(permissions)
      .where(notInArray(permissions.key, PERMISSION_KEYS))
      .returning({ key: permissions.key });
    if (removed.length > 0) {
      // Forget retired keys so they apply again if ever re-introduced.
      await tx.delete(accessDefaultsApplied).where(
        inArray(
          accessDefaultsApplied.permissionKey,
          removed.map((row) => row.key),
        ),
      );
    }

    const rolesCreated: string[] = [];
    let grantsApplied = 0;
    for (const key of ROLE_KEYS) {
      const definition = ROLES[key];
      let [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
      if (role) {
        await tx
          .update(roles)
          .set({ name: definition.name, description: definition.description })
          .where(eq(roles.id, role.id));
      } else {
        [role] = await tx
          .insert(roles)
          .values({ key, name: definition.name, description: definition.description, isSystem: true })
          .returning({ id: roles.id });
        rolesCreated.push(key);
      }

      const applied = await tx
        .select({ permissionKey: accessDefaultsApplied.permissionKey })
        .from(accessDefaultsApplied)
        .where(eq(accessDefaultsApplied.roleKey, key));
      const alreadyApplied = new Set(applied.map((row) => row.permissionKey));
      const pending = definition.permissions.filter((permissionKey) => !alreadyApplied.has(permissionKey));
      if (pending.length === 0) continue;

      await tx
        .insert(rolePermissions)
        .values(pending.map((permissionKey) => ({ roleId: role!.id, permissionKey })))
        .onConflictDoNothing();
      await tx
        .insert(accessDefaultsApplied)
        .values(pending.map((permissionKey) => ({ roleKey: key, permissionKey })))
        .onConflictDoNothing();
      grantsApplied += pending.length;
    }

    return {
      permissionsUpserted: PERMISSION_KEYS.length,
      permissionsRemoved: removed.length,
      rolesCreated,
      grantsApplied,
    };
  });
}
