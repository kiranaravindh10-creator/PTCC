import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { requirePermission } from "@/server/access/actor";
import { diff, writeAudit } from "@/server/audit";
import type { Ctx } from "@/server/context";
import { outerId } from "@/server/db/sql";
import { accreditations, branches, users } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { optionalEmail, optionalPhone, optionalText, parseInput, requiredText, uuidField } from "@/server/validation";

/**
 * Branches — one PTCC platform, branch-level data isolation. Branches confirmed by an
 * accreditation certificate are created by the scope import; others (e.g. a branch whose
 * details PTCC has not yet provided) are added here and stay "needs verification" until an
 * administrator confirms them.
 */

const branchSchema = z.object({
  name: requiredText(80, "Enter the branch name, e.g. the city."),
  addressLine: optionalText(300),
  city: optionalText(80),
  state: optionalText(80),
  pincode: optionalText(12),
  phone: optionalPhone,
  email: optionalEmail,
  mapsUrl: optionalText(1000).refine((value) => !value || /^https:\/\/\S+$/.test(value), "Paste the full Google Maps link (https://…)."),
  description: optionalText(500),
  notes: optionalText(1000),
  verified: z.union([z.literal("on"), z.boolean()]).optional().transform(Boolean),
});

export type BranchInput = z.input<typeof branchSchema>;

export async function createBranch(ctx: Ctx, input: BranchInput): Promise<{ id: string }> {
  requirePermission(ctx.actor, "branch.manage");
  const data = parseInput(branchSchema, input);
  return ctx.db.transaction(async (tx) => {
    await assertNameFree(tx, data.name);
    const [branch] = await tx
      .insert(branches)
      .values({
        name: data.name,
        addressLine: data.addressLine ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        pincode: data.pincode ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        mapsUrl: data.mapsUrl ?? null,
        description: data.description ?? null,
        notes: data.notes ?? null,
        verification: data.verified ? "verified" : "needs_verification",
        createdBy: ctx.actor.id,
        updatedBy: ctx.actor.id,
      })
      .returning({ id: branches.id });
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "branch.create",
      entityType: "branch",
      entityId: branch!.id,
      summary: `Added branch ${data.name}${data.verified ? "" : " (needs verification)"}`,
      meta: ctx.meta,
    });
    return branch!;
  });
}

export async function updateBranch(ctx: Ctx, input: BranchInput & { id: string }): Promise<void> {
  requirePermission(ctx.actor, "branch.manage");
  const id = parseInput(uuidField, input.id);
  const data = parseInput(branchSchema, input);
  await ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(branches).where(eq(branches.id, id)).for("update").limit(1);
    if (!before) throw new NotFoundError();
    await assertNameFree(tx, data.name, id);
    const after = {
      name: data.name,
      addressLine: data.addressLine ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      pincode: data.pincode ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      mapsUrl: data.mapsUrl ?? null,
      description: data.description ?? null,
      notes: data.notes ?? null,
      verification: data.verified ? ("verified" as const) : ("needs_verification" as const),
    };
    await tx.update(branches).set({ ...after, updatedBy: ctx.actor.id }).where(eq(branches.id, id));
    const changes = diff(before as unknown as Record<string, unknown>, after);
    if (Object.keys(changes).length > 0) {
      await writeAudit(tx, {
        actorId: ctx.actor.id,
        action: "branch.update",
        entityType: "branch",
        entityId: id,
        summary: `Updated branch ${data.name}`,
        changes,
        meta: ctx.meta,
      });
    }
  });
}

/** Deactivates or reactivates a branch. A branch with active people can't be deactivated. */
export async function setBranchStatus(ctx: Ctx, input: { id: string; status: "active" | "inactive" }): Promise<void> {
  requirePermission(ctx.actor, "branch.manage");
  const id = parseInput(uuidField, input.id);
  const status = parseInput(z.enum(["active", "inactive"]), input.status);
  await ctx.db.transaction(async (tx) => {
    if (status === "inactive") {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.branchId, id), eq(users.status, "active")));
      if ((row?.n ?? 0) > 0) {
        throw new ConflictError(`${row!.n} active ${row!.n === 1 ? "person works" : "people work"} at this branch. Move them first.`);
      }
    }
    const [branch] = await tx
      .update(branches)
      .set({ status, updatedBy: ctx.actor.id })
      .where(eq(branches.id, id))
      .returning({ name: branches.name });
    if (!branch) throw new NotFoundError();
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: status === "inactive" ? "branch.deactivate" : "branch.reactivate",
      entityType: "branch",
      entityId: id,
      summary: `${status === "inactive" ? "Deactivated" : "Reactivated"} branch ${branch.name}`,
      meta: ctx.meta,
    });
  });
}

export type BranchRow = typeof branches.$inferSelect & {
  activePeople: number;
  certificates: string[];
};

export async function listBranches(ctx: Pick<Ctx, "db" | "actor">): Promise<BranchRow[]> {
  requirePermission(ctx.actor, "branch.manage");
  const rows = await ctx.db
    .select({
      branch: branches,
      activePeople: sql<number>`(select count(*)::int from ${users} u where u.branch_id = ${outerId(branches)} and u.status = 'active')`,
      certificates: sql<string[] | null>`(select array_agg(a.certificate_number order by a.certificate_number) from ${accreditations} a where a.branch_id = ${outerId(branches)})`,
    })
    .from(branches)
    .orderBy(asc(branches.status), asc(branches.name));
  return rows.map((row) => ({ ...row.branch, activePeople: row.activePeople, certificates: row.certificates ?? [] }));
}

export async function getBranch(ctx: Pick<Ctx, "db" | "actor">, id: string) {
  requirePermission(ctx.actor, "branch.manage");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [branch] = await ctx.db.select().from(branches).where(eq(branches.id, id)).limit(1);
  return branch ?? null;
}

async function assertNameFree(tx: Pick<Ctx["db"], "select">, name: string, exceptId?: string) {
  const [existing] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(sql`lower(${branches.name}) = lower(${name})`, exceptId ? ne(branches.id, exceptId) : undefined))
    .limit(1);
  if (existing) throw new ValidationError("Please check the highlighted fields.", { name: "A branch with this name already exists." });
}
