import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import type { Database } from "@/server/db/client";
import { branches } from "@/server/db/schema";
import { normalizePhone } from "@/lib/phone";

/**
 * Registers branches from PTCC's branch directory (data/branches/ptcc-branches.json) —
 * contact details supplied by PTCC, never accreditation. Safe to run repeatedly:
 * - a branch that doesn't exist is created ("details confirmed", since PTCC supplied them);
 * - an existing branch only has EMPTY fields filled in — an Admin's later edits always win.
 * Every change is written to the activity log.
 */

const text = z.string().trim().min(1);

export const branchDirectorySchema = z.object({
  format: z.literal("ptcc-branches/v1"),
  note: z.string(),
  branches: z
    .array(
      z.object({
        name: text.max(80),
        addressLine: text.max(300).optional(),
        city: text.max(80).optional(),
        state: text.max(80).optional(),
        pincode: z.string().regex(/^\d{6}$/).optional(),
        phone: text
          .optional()
          .refine((value) => value === undefined || normalizePhone(value) !== null, "Not a valid phone number"),
        email: z.email().optional(),
        mapsUrl: z.url({ protocol: /^https$/ }).optional(),
        description: text.max(500).optional(),
        notes: text.max(1000).optional(),
      }),
    )
    .min(1),
});

export type BranchDirectoryResult = { created: string[]; updated: string[]; unchanged: string[] };

const FIELDS = ["addressLine", "city", "state", "pincode", "phone", "email", "mapsUrl", "description", "notes"] as const;

export async function importBranchDirectory(db: Database, input: unknown): Promise<BranchDirectoryResult> {
  const file = branchDirectorySchema.parse(input);
  const result: BranchDirectoryResult = { created: [], updated: [], unchanged: [] };
  await db.transaction(async (tx) => {
    for (const entry of file.branches) {
      const values = {
        addressLine: entry.addressLine ?? null,
        city: entry.city ?? null,
        state: entry.state ?? null,
        pincode: entry.pincode ?? null,
        phone: entry.phone ? normalizePhone(entry.phone) : null,
        email: entry.email?.toLowerCase() ?? null,
        mapsUrl: entry.mapsUrl ?? null,
        description: entry.description ?? null,
        notes: entry.notes ?? null,
      };
      const [existing] = await tx
        .select()
        .from(branches)
        .where(sql`lower(${branches.name}) = lower(${entry.name})`)
        .limit(1);

      if (!existing) {
        const [created] = await tx
          .insert(branches)
          .values({ name: entry.name, ...values, verification: "verified" })
          .returning({ id: branches.id });
        await writeAudit(tx, {
          actorId: null,
          action: "branch.create",
          entityType: "branch",
          entityId: created!.id,
          summary: `Added branch ${entry.name} from PTCC's branch directory (accreditation not verified)`,
        });
        result.created.push(entry.name);
        continue;
      }

      const fill: Partial<typeof values> = {};
      const changes: Record<string, [unknown, unknown]> = {};
      for (const field of FIELDS) {
        if ((existing[field] === null || existing[field] === "") && values[field] !== null) {
          fill[field] = values[field];
          changes[field] = [existing[field], values[field]];
        }
      }
      if (Object.keys(fill).length === 0) {
        result.unchanged.push(entry.name);
        continue;
      }
      await tx.update(branches).set(fill).where(eq(branches.id, existing.id));
      await writeAudit(tx, {
        actorId: null,
        action: "branch.update",
        entityType: "branch",
        entityId: existing.id,
        summary: `Filled in ${existing.name}'s details from PTCC's branch directory`,
        changes,
      });
      result.updated.push(entry.name);
    }
  });
  return result;
}
