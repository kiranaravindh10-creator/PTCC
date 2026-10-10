import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, id, inList, updatedAt } from "./_columns";

export const USER_STATUSES = ["active", "inactive"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const BRANCH_STATUSES = ["active", "inactive"] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

/** Whether a branch's details are confirmed (e.g. by an accreditation certificate) or still to be checked. */
export const BRANCH_VERIFICATIONS = ["verified", "needs_verification"] as const;
export type BranchVerification = (typeof BRANCH_VERIFICATIONS)[number];

/**
 * PTCC's branches. One platform, branch-level data isolation, company-wide view for the CEO —
 * docs/SYSTEM_ARCHITECTURE.md "Multi-branch". Defined here, beside users, because every
 * user has a home branch and branches record who created them.
 */
export const branches = pgTable(
  "branches",
  {
    id: id(),
    /** How people refer to the branch: "Bengaluru". */
    name: text().notNull(),
    addressLine: text(),
    city: text(),
    state: text(),
    pincode: text(),
    phone: text(),
    email: text(),
    /** Google Maps link to the branch, as supplied by PTCC. */
    mapsUrl: text(),
    /** One or two sentences about the branch, as supplied by PTCC. */
    description: text(),
    status: text().$type<BranchStatus>().notNull().default("active"),
    verification: text().$type<BranchVerification>().notNull().default("needs_verification"),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid().references((): AnyPgColumn => users.id, { onDelete: "restrict" }),
    updatedBy: uuid().references((): AnyPgColumn => users.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("branches_name_unique").on(sql`lower(${t.name})`),
    check("branches_status_check", inList(t.status, BRANCH_STATUSES)),
    check("branches_verification_check", inList(t.verification, BRANCH_VERIFICATIONS)),
  ],
);

/** Everyone who signs in to PTCC. */
export const users = pgTable(
  "users",
  {
    id: id(),
    name: text().notNull(),
    /** E.164, e.g. +919876543210 — the primary sign-in identifier. */
    phone: text().notNull(),
    /** Lower-cased; optional sign-in identifier. */
    email: text(),
    /** Never selected outside src/server/auth. */
    passwordHash: text().notNull(),
    designation: text(),
    /**
     * Home branch. Branch-scoped permissions (`*.branch`) apply to this branch.
     * Null only for company-level people (e.g. CEO, Admin) whose access is company-wide.
     */
    branchId: uuid().references((): AnyPgColumn => branches.id, { onDelete: "restrict" }),
    status: text().$type<UserStatus>().notNull().default("active"),
    mustChangePassword: boolean().notNull().default(false),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid().references((): AnyPgColumn => users.id, { onDelete: "restrict" }),
    updatedBy: uuid().references((): AnyPgColumn => users.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("users_phone_unique").on(t.phone),
    uniqueIndex("users_email_unique").on(t.email),
    index("users_branch_idx").on(t.branchId),
    check("users_status_check", inList(t.status, USER_STATUSES)),
    check("users_email_lowercase_check", sql`${t.email} = lower(${t.email})`),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: id(),
    key: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    isSystem: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roles_key_unique").on(t.key)],
);

export const permissions = pgTable("permissions", {
  key: text().primaryKey(),
  groupName: text().notNull(),
  description: text().notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text()
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade", onUpdate: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

/**
 * Which default grants (role → permission) `db:sync-access` has already applied.
 * A default is applied once; if an Admin later removes it, it is not re-added.
 * This lets new or renamed permissions reach existing roles without overwriting Admin changes.
 */
export const accessDefaultsApplied = pgTable(
  "access_defaults_applied",
  {
    roleKey: text().notNull(),
    permissionKey: text().notNull(),
    appliedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.roleKey, t.permissionKey] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    assignedBy: uuid().references(() => users.id, { onDelete: "restrict" }),
    assignedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index("user_roles_role_idx").on(t.roleId)],
);

/**
 * Server-side sessions. `id` is the SHA-256 hash of the token held in the user's
 * cookie, so a copy of this table cannot be used to sign in.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ip: text(),
    userAgent: text(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Sign-in attempts, used for rate limiting and lockout. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: id(),
    identifier: text().notNull(),
    ip: text(),
    succeeded: boolean().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("login_attempts_identifier_idx").on(t.identifier, t.createdAt),
    index("login_attempts_ip_idx").on(t.ip, t.createdAt),
  ],
);
