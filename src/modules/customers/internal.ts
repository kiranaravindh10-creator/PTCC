import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { writeAudit } from "@/server/audit";
import type { Ctx } from "@/server/context";
import type { Transaction } from "@/server/db/client";
import { companies, companyBranches, contacts, type CompanyRelationship } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";
import { normalizeCompanyName } from "@/lib/company";

/**
 * Trusted helpers for other module services working inside their own transaction.
 */

/**
 * Records that a company deals with a branch (no-op if already linked). Creating work or a
 * lead for a customer at a branch implies the relationship — nobody has to enter it twice.
 * Returns true when a new link was created.
 */
export async function ensureCompanyBranch(
  tx: Transaction,
  input: { companyId: string; branchId: string; actorId: string; relationship?: CompanyRelationship; at?: Date },
): Promise<boolean> {
  const inserted = await tx
    .insert(companyBranches)
    .values({
      companyId: input.companyId,
      branchId: input.branchId,
      relationship: input.relationship ?? "prospect",
      becameCustomerAt: input.relationship === "customer" ? (input.at ?? new Date()) : null,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .onConflictDoNothing()
    .returning({ companyId: companyBranches.companyId });
  return inserted.length > 0;
}

/** Makes the company a customer of the branch (keeps the first "became customer" date). */
export async function markCustomerOfBranch(
  tx: Transaction,
  input: { companyId: string; branchId: string; actorId: string; at: Date },
): Promise<{ changed: boolean }> {
  await ensureCompanyBranch(tx, { companyId: input.companyId, branchId: input.branchId, actorId: input.actorId });
  const updated = await tx
    .update(companyBranches)
    .set({
      relationship: "customer",
      becameCustomerAt: sql`coalesce(${companyBranches.becameCustomerAt}, ${input.at.toISOString()}::timestamptz)`,
      updatedBy: input.actorId,
    })
    .where(
      and(
        eq(companyBranches.companyId, input.companyId),
        eq(companyBranches.branchId, input.branchId),
        sql`${companyBranches.relationship} <> 'customer'`,
      ),
    )
    .returning({ companyId: companyBranches.companyId });
  return { changed: updated.length > 0 };
}

/**
 * Finds a contact at the company by phone (or, failing that, by name) — or creates one.
 * Keeps one record per person instead of a copy per lead.
 */
export async function findOrCreateContact(
  tx: Transaction,
  input: { companyId: string; name?: string | null; phone?: string | null; email?: string | null; actorId: string },
): Promise<{ id: string; name: string; phone: string | null } | null> {
  const name = input.name?.trim() || null;
  const phone = input.phone ?? null;
  if (!name && !phone) return null;

  if (phone) {
    const [byPhone] = await tx
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
      .from(contacts)
      .where(and(eq(contacts.companyId, input.companyId), eq(contacts.phone, phone)))
      .limit(1);
    if (byPhone) return byPhone;
  }
  if (name) {
    const [byName] = await tx
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
      .from(contacts)
      .where(and(eq(contacts.companyId, input.companyId), sql`lower(${contacts.name}) = lower(${name})`))
      .limit(1);
    if (byName) {
      if (phone && !byName.phone) {
        await tx.update(contacts).set({ phone, updatedBy: input.actorId }).where(eq(contacts.id, byName.id));
        return { ...byName, phone };
      }
      return byName;
    }
  }
  const [{ count: existing } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.companyId, input.companyId));
  const [created] = await tx
    .insert(contacts)
    .values({
      companyId: input.companyId,
      name: name ?? "Contact",
      phone,
      email: input.email ?? null,
      isPrimary: existing === 0,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .returning({ id: contacts.id, name: contacts.name, phone: contacts.phone });
  return created!;
}

/** Creates a company, refusing an exact duplicate (same normalised name). */
export async function createCompanyRecord(
  tx: Transaction,
  ctx: Ctx,
  input: {
    name: string;
    industry?: string;
    phone?: string;
    email?: string;
    website?: string;
    addressLine?: string;
    area?: string;
    city?: string;
    state?: string;
    pincode?: string;
  },
) {
  const normalizedName = normalizeCompanyName(input.name);
  const [existing] = await tx
    .select({ id: companies.id, name: companies.name, area: companies.area, city: companies.city })
    .from(companies)
    .where(eq(companies.normalizedName, normalizedName))
    .limit(1);
  if (existing) {
    const where = [existing.area, existing.city].filter(Boolean).join(", ");
    throw new ValidationError("Please check the highlighted fields.", {
      companyName: `“${existing.name}”${where ? ` (${where})` : ""} already exists. Choose it from the suggestions — or, if it's a different company, add the city to the name.`,
    });
  }
  const [company] = await tx
    .insert(companies)
    .values({
      name: input.name,
      normalizedName,
      industry: input.industry ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      website: input.website ?? null,
      addressLine: input.addressLine ?? null,
      area: input.area ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      pincode: input.pincode ?? null,
      createdBy: ctx.actor.id,
      updatedBy: ctx.actor.id,
    })
    .returning({ id: companies.id, name: companies.name, addressLine: companies.addressLine, area: companies.area });
  await writeAudit(tx, {
    actorId: ctx.actor.id,
    action: "customer.create",
    entityType: "company",
    entityId: company!.id,
    summary: `Added customer ${input.name}`,
    meta: ctx.meta,
  });
  return company!;
}
