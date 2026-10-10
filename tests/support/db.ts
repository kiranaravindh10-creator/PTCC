import fs from "node:fs";
import path from "node:path";
import { loadActor } from "@/server/access/load";
import type { RoleKey } from "@/server/access/roles";
import { syncAccess } from "@/server/access/sync";
import { hashPassword } from "@/server/auth/password";
import type { Ctx } from "@/server/context";
import { openDatabase, type Database, type DatabaseHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { branches, companies, companyBranches, contacts, roles, userRoles, users } from "@/server/db/schema";
import { normalizePhone } from "@/lib/phone";
import { normalizeCompanyName } from "@/lib/company";
import { importBranchDirectory } from "@/modules/branches/import";
import { importScope } from "@/modules/catalogue/import";

/** A fresh in-memory PostgreSQL (PGlite) with all migrations and roles applied. */
export async function createTestDatabase(): Promise<DatabaseHandle> {
  const handle = openDatabase({ driver: "pglite" });
  await runMigrations(handle);
  await syncAccess(handle.db);
  return handle;
}

/** Imports PTCC's real scope file (creates the Bengaluru, Chennai and Hosur branches). */
export async function importTestScope(db: Database) {
  const root = path.resolve(__dirname, "../..");
  const scope = JSON.parse(fs.readFileSync(path.join(root, "data/scope/ptcc-nabl-scope.json"), "utf8"));
  const branchMap = JSON.parse(fs.readFileSync(path.join(root, "data/scope/branches.json"), "utf8"));
  return importScope(db, { scope, branchMap });
}

/** Imports PTCC's real branch directory (registers Hyderabad, whose accreditation is not verified). */
export async function importTestBranchDirectory(db: Database) {
  const root = path.resolve(__dirname, "../..");
  return importBranchDirectory(db, JSON.parse(fs.readFileSync(path.join(root, "data/branches/ptcc-branches.json"), "utf8")));
}

export async function createTestBranch(db: Database, name: string): Promise<string> {
  const [branch] = await db.insert(branches).values({ name }).returning({ id: branches.id });
  return branch!.id;
}

export async function branchIdByName(db: Database, name: string): Promise<string> {
  const rows = await db.select({ id: branches.id, name: branches.name }).from(branches);
  const found = rows.find((row) => row.name === name);
  if (!found) throw new Error(`No branch ${name}`);
  return found.id;
}

let phoneCounter = 0;
let cachedHash: Promise<string> | null = null;

export const TEST_PASSWORD = "correct horse battery";

/** Inserts a person with the given roles (and home branch) and returns their id. */
export async function createTestUser(
  db: Database,
  options: {
    name?: string;
    roles: RoleKey[];
    branchId?: string | null;
    phone?: string;
    status?: "active" | "inactive";
    mustChangePassword?: boolean;
  },
): Promise<string> {
  phoneCounter += 1;
  cachedHash ??= hashPassword(TEST_PASSWORD);
  const [user] = await db
    .insert(users)
    .values({
      name: options.name ?? `Test Person ${phoneCounter}`,
      phone: normalizePhone(options.phone ?? `98${String(phoneCounter).padStart(8, "0")}`)!,
      passwordHash: await cachedHash,
      branchId: options.branchId ?? null,
      status: options.status ?? "active",
      mustChangePassword: options.mustChangePassword ?? false,
    })
    .returning({ id: users.id });
  const roleRows = await db.select().from(roles);
  for (const key of options.roles) {
    await db.insert(userRoles).values({ userId: user!.id, roleId: roleRows.find((role) => role.key === key)!.id });
  }
  return user!.id;
}

/** A company linked to the given branches, with a primary contact. */
export async function createTestCompany(
  db: Database,
  options: { name: string; branchIds: string[]; area?: string; contactName?: string; contactPhone?: string },
): Promise<string> {
  const [company] = await db
    .insert(companies)
    .values({
      name: options.name,
      normalizedName: normalizeCompanyName(options.name),
      area: options.area ?? null,
      addressLine: options.area ? `${options.area} Industrial Area` : null,
    })
    .returning({ id: companies.id });
  for (const branchId of options.branchIds) {
    await db.insert(companyBranches).values({ companyId: company!.id, branchId });
  }
  if (options.contactName) {
    await db.insert(contacts).values({
      companyId: company!.id,
      name: options.contactName,
      phone: options.contactPhone ? normalizePhone(options.contactPhone) : null,
      isPrimary: true,
    });
  }
  return company!.id;
}

export async function contextFor(db: Database, userId: string, now: Date = new Date()): Promise<Ctx> {
  const actor = await loadActor(db, userId);
  if (!actor) throw new Error(`No active user ${userId}`);
  return { db, actor, meta: { ip: "127.0.0.1", userAgent: "vitest" }, now };
}
