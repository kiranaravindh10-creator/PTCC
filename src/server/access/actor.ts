import { ForbiddenError } from "../errors";
import type { PermissionKey } from "./permissions";
import type { RoleKey } from "./roles";

/** The signed-in person on whose behalf code runs. Built once per request. */
export type Actor = {
  id: string;
  name: string;
  roleKeys: readonly RoleKey[];
  permissions: ReadonlySet<PermissionKey>;
  mustChangePassword: boolean;
  /** Home branch; branch-scoped permissions apply here. null for company-level people. */
  branchId: string | null;
  branchName: string | null;
};

export function can(actor: Actor, permission: PermissionKey): boolean {
  return actor.permissions.has(permission);
}

export function canAny(actor: Actor, ...permissions: PermissionKey[]): boolean {
  return permissions.some((permission) => actor.permissions.has(permission));
}

export function hasRole(actor: Actor, role: RoleKey): boolean {
  return actor.roleKeys.includes(role);
}

/** Throws ForbiddenError unless the actor holds the permission. Use in every service. */
export function requirePermission(actor: Actor, permission: PermissionKey): void {
  if (!can(actor, permission)) throw new ForbiddenError();
}

export type Scope = "own" | "branch" | "all";

/** Capabilities that come in `.own` / `.branch` / `.all` widths. */
export type ScopedCapability =
  | "task.read"
  | "task.assign"
  | "task.manage"
  | "team.view"
  | "collection.read"
  | "marketing.read"
  | "marketing.assign";

/**
 * The widest scope the actor holds for a capability, or null.
 * A `.branch` permission only counts when the person has a home branch.
 */
export function scopeOf(actor: Actor, capability: ScopedCapability): Scope | null {
  if (actor.permissions.has(`${capability}.all` as PermissionKey)) return "all";
  if (actor.branchId && actor.permissions.has(`${capability}.branch` as PermissionKey)) return "branch";
  if (actor.permissions.has(`${capability}.own` as PermissionKey)) return "own";
  return null;
}

/** True if the actor's scope for a capability covers records of `branchId`. */
export function coversBranch(actor: Actor, capability: ScopedCapability, branchId: string | null): boolean {
  const scope = scopeOf(actor, capability);
  if (scope === "all") return true;
  return scope === "branch" && branchId !== null && branchId === actor.branchId;
}
