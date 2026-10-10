/**
 * PTCC's system roles and their default permissions (docs/USER_ROLES.md §3).
 *
 * `npm run db:sync-access` applies each default grant to its role once. If an Admin later
 * removes a grant, it is not re-added — so Admin changes are never overwritten by a
 * deployment, while new or renamed permissions still reach existing roles.
 */

import type { PermissionKey } from "./permissions";

type RoleDefinition = {
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
};

const everyone: readonly PermissionKey[] = ["task.read.own", "task.work", "lead.capture", "catalogue.read"];

export const ROLES = {
  ceo: {
    name: "CEO",
    description: "Controls all branches: company-wide view, comparisons, decisions and alerts",
    permissions: [
      ...everyone,
      "overview.company",
      "team.view.all",
      "task.read.all",
      "task.create",
      "task.assign.all",
      "task.manage.all",
      "collection.read.all",
      "customer.read.all",
      "customer.write",
      "marketing.read.all",
      "marketing.work",
      "marketing.assign.all",
      "user.manage",
      "branch.manage",
      "audit.read",
    ],
  },
  admin: {
    name: "Admin",
    description: "People, roles, branches, the service catalogue and system settings",
    permissions: [
      ...everyone,
      "task.create",
      "lead.route",
      "user.manage",
      "role.manage",
      "branch.manage",
      "catalogue.manage",
      "audit.read",
    ],
  },
  hr: {
    name: "HR / Coordinator",
    description: "Runs a branch day to day: assigns and balances work, schedules pickups and deliveries, routes leads",
    permissions: [
      ...everyone,
      "team.view.branch",
      "task.read.branch",
      "task.create",
      "task.assign.branch",
      "task.manage.branch",
      "collection.read.branch",
      "customer.read",
      "customer.write",
      "marketing.read.branch",
      "marketing.assign.branch",
    ],
  },
  marketing_manager: {
    name: "Marketing manager",
    description: "Leads a branch's marketing team: sees all branch leads, assigns them, follows up",
    permissions: [
      ...everyone,
      "task.create",
      "customer.read",
      "customer.write",
      "marketing.read.branch",
      "marketing.work",
      "marketing.assign.branch",
    ],
  },
  marketing: {
    name: "Marketing",
    description: "Leads, customers, calls, follow-ups, quotations and deals",
    permissions: [...everyone, "task.create", "customer.read", "customer.write", "marketing.read.own", "marketing.work"],
  },
  collection: {
    name: "Collection",
    description: "Pickups, deliveries and routes",
    permissions: [...everyone, "collection.read.own"],
  },
  operations: {
    name: "Operations / Lab",
    description: "Receiving instruments, calibration/testing, certificates and dispatch",
    permissions: [...everyone, "task.create", "collection.read.branch", "customer.read"],
  },
  accounts: {
    name: "Accounts",
    description: "Payment follow-up and business status; accounting stays in Tally",
    permissions: [...everyone, "task.create", "customer.read"],
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleKey = keyof typeof ROLES;

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

/** Roles whose work is company-wide; people holding only these don't need a home branch. */
export const COMPANY_LEVEL_ROLES: readonly RoleKey[] = ["ceo", "admin"];

export function isRoleKey(value: string): value is RoleKey {
  return Object.hasOwn(ROLES, value);
}
