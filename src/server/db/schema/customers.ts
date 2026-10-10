import { boolean, check, index, numeric, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, inList, updatedAt, userRef } from "./_columns";
import { branches, users } from "./identity";

/**
 * Customers — docs/DATABASE_ARCHITECTURE.md §4.
 *
 * A company is ONE central record used by Marketing, Collections, Operations, Accounts and the
 * CEO. It is not owned by a branch: its relationships with PTCC branches live in
 * `company_branches`, so ABC Engineering can be a Bengaluru customer and a Chennai prospect
 * while remaining one company.
 */

export const companies = pgTable(
  "companies",
  {
    id: id(),
    name: text().notNull(),
    /** Lower-cased name without punctuation or legal suffixes — for duplicate detection. */
    normalizedName: text().notNull(),
    industry: text(),
    phone: text(),
    email: text(),
    website: text(),
    addressLine: text(),
    /** Locality PTCC staff use, e.g. "Peenya", "Whitefield". */
    area: text(),
    city: text(),
    state: text(),
    pincode: text(),
    latitude: numeric({ precision: 9, scale: 6 }),
    longitude: numeric({ precision: 9, scale: 6 }),
    notes: text(),
    /** Archived companies are hidden from pickers but keep their history. */
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: userRef(() => users.id),
    updatedBy: userRef(() => users.id),
  },
  (t) => [index("companies_normalized_name_idx").on(t.normalizedName)],
);

export const COMPANY_RELATIONSHIPS = ["prospect", "customer", "inactive"] as const;
export type CompanyRelationship = (typeof COMPANY_RELATIONSHIPS)[number];

/** A company's relationship with one PTCC branch. */
export const companyBranches = pgTable(
  "company_branches",
  {
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    relationship: text().$type<CompanyRelationship>().notNull().default("prospect"),
    /** The marketer responsible for this company at this branch (optional). */
    ownerId: userRef(() => users.id),
    becameCustomerAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: userRef(() => users.id),
    updatedBy: userRef(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.branchId] }),
    index("company_branches_branch_idx").on(t.branchId, t.relationship),
    check("company_branches_relationship_check", inList(t.relationship, COMPANY_RELATIONSHIPS)),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text().notNull(),
    phone: text(),
    email: text(),
    designation: text(),
    isPrimary: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: userRef(() => users.id),
    updatedBy: userRef(() => users.id),
  },
  (t) => [index("contacts_company_idx").on(t.companyId), index("contacts_phone_idx").on(t.phone)],
);
