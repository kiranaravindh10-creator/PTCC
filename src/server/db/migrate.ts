import "server-only";
import path from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { DatabaseHandle, Schema } from "./client";

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

/** Applies all pending SQL migrations from `drizzle/` (forward-only). */
export async function runMigrations(handle: DatabaseHandle): Promise<void> {
  if (handle.driver === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db as unknown as PgliteDatabase<Schema>, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(handle.db as unknown as PostgresJsDatabase<Schema>, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}
