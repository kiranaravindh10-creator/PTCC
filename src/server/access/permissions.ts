/**
 * Permission catalogue — the single list of capabilities the code enforces.
 *
 * Keys are defined here (in code) because code checks them. Which roles hold which
 * permissions is stored in the database and seeded from `roles.ts`, so an Admin can
 * adjust assignments later without a deployment. See docs/USER_ROLES.md.
 *
 * Branch scope: many capabilities come in three widths —
 *   `.own`    records assigned to / created by / owned by me
 *   `.branch` records of my home branch
 *   `.all`    records of every branch (company-wide)
 * `scopeOf()` in actor.ts resolves the widest one a person holds.
 */

export const PERMISSIONS = {
  // Home
  "overview.company": { group: "Home", description: "See the company overview for all branches, with a branch filter" },

  // Team
  "team.view.branch": { group: "Team", description: "See the open work and workload of people in my branch" },
  "team.view.all": { group: "Team", description: "See open work and workload across all branches" },

  // Work
  "task.read.own": { group: "Work", description: "See work assigned to or created by me" },
  "task.read.branch": { group: "Work", description: "See all work in my branch" },
  "task.read.all": { group: "Work", description: "See all work in every branch" },
  "task.work": { group: "Work", description: "Update and comment on work assigned to me" },
  "task.create": { group: "Work", description: "Create work" },
  "task.assign.branch": { group: "Work", description: "Assign or reassign work within my branch" },
  "task.assign.all": { group: "Work", description: "Assign work in any branch, including moving it between branches" },
  "task.manage.branch": { group: "Work", description: "Close or cancel any work in my branch" },
  "task.manage.all": { group: "Work", description: "Close or cancel any work in every branch" },

  // Collections
  "collection.read.own": { group: "Collections", description: "Open Collections and see my own pickups and deliveries" },
  "collection.read.branch": { group: "Collections", description: "See every pickup and delivery in my branch" },
  "collection.read.all": { group: "Collections", description: "See every pickup and delivery in the company" },

  // Customers
  "customer.read": {
    group: "Customers",
    description: "See customers linked to my branch (and search all names, to avoid duplicates)",
  },
  "customer.read.all": { group: "Customers", description: "See every customer and its relationships with all branches" },
  "customer.write": { group: "Customers", description: "Add and edit customers and contacts; link a customer to my branch" },

  // Marketing
  "lead.capture": { group: "Marketing", description: "Add a lead for any branch (or mark its branch as unknown)" },
  "marketing.read.own": { group: "Marketing", description: "See leads I own or added" },
  "marketing.read.branch": { group: "Marketing", description: "See all leads, calls and quotations in my branch" },
  "marketing.read.all": { group: "Marketing", description: "See leads of every branch, including leads waiting for a branch" },
  "marketing.work": {
    group: "Marketing",
    description: "Work my leads: calls, notes, follow-ups, stages, requirements, quotations, won/lost",
  },
  "marketing.assign.branch": { group: "Marketing", description: "Assign and reassign leads within my branch, and work any of them" },
  "marketing.assign.all": { group: "Marketing", description: "Assign leads in any branch and decide which branch a lead belongs to" },
  "lead.route": {
    group: "Marketing",
    description: "Route leads in every branch: set or change a lead's branch and assign or reassign its owner (audited) — without working the lead",
  },

  // Service catalogue (PTCC's accredited scope)
  "catalogue.read": { group: "Services", description: "Search PTCC's accredited calibration scope" },
  "catalogue.manage": { group: "Services", description: "Review the imported scope documents and accreditation certificates" },

  // Administration
  "user.manage": { group: "Administration", description: "Add people, set branch and roles, deactivate accounts, reset passwords" },
  "role.manage": { group: "Administration", description: "View and change what each role can do" },
  "branch.manage": { group: "Administration", description: "Add and edit branches" },
  "audit.read": { group: "Administration", description: "Read the activity (audit) log" },
} as const satisfies Record<string, { group: string; description: string }>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSIONS, value);
}
