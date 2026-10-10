import "server-only";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { acquirePgliteLock } from "./pglite-lock";
import * as schema from "./schema";

/**
 * Database access for PTCC.
 *
 * - Production (and any environment with DATABASE_URL): PostgreSQL via postgres.js.
 * - Development without DATABASE_URL: PGlite — real PostgreSQL compiled to WASM,
 *   stored in `.data/pglite`. No installation needed.
 * - Tests: in-memory PGlite (see tests/support/db.ts).
 *
 * Application code receives a `Database` and never needs to know which driver is used.
 */

export type Schema = typeof schema;
export type Database = PgDatabase<PgQueryResultHKT, Schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the database or an open transaction. */
export type Executor = Database | Transaction;

export type DatabaseHandle = {
  db: Database;
  driver: "pglite" | "postgres";
  close: () => Promise<void>;
};

const DRIZZLE_OPTIONS = { schema, casing: "snake_case" } as const;

export type OpenDatabaseOptions =
  | { driver: "postgres"; url: string }
  /** `dataDir` undefined ⇒ in-memory database. */
  | { driver: "pglite"; dataDir?: string };

export function openDatabase(options: OpenDatabaseOptions): DatabaseHandle {
  if (options.driver === "postgres") {
    const client = postgres(options.url, { max: 10 });
    const db: PostgresJsDatabase<Schema> = drizzlePostgres({ client, ...DRIZZLE_OPTIONS });
    return { db: db as unknown as Database, driver: "postgres", close: () => client.end() };
  }

  const releaseLock = options.dataDir ? acquirePgliteLock(options.dataDir) : () => {};
  const client = options.dataDir ? new PGlite(options.dataDir) : new PGlite();
  const db: PgliteDatabase<Schema> = drizzlePglite({ client, ...DRIZZLE_OPTIONS });
  return {
    db: db as unknown as Database,
    driver: "pglite",
    close: async () => {
      await client.close();
      releaseLock();
    },
  };
}

/** Resolves which database to open from the environment. */
export function databaseOptionsFromEnv(): OpenDatabaseOptions {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return { driver: "postgres", url };

  if (process.env.NODE_ENV === "production" && process.env.PTCC_ALLOW_PGLITE_IN_PRODUCTION !== "true") {
    throw new Error(
      "DATABASE_URL is not set. Production requires PostgreSQL; the embedded development database is disabled.",
    );
  }
  // Development-only local path: excluded from production file tracing.
  const dataDir = path.resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    process.env.PGLITE_DATA_DIR?.trim() || ".data/pglite",
  );
  return { driver: "pglite", dataDir };
}

// One handle per server process, kept across hot reloads in development.
const globalForDb = globalThis as unknown as { __ptccDb?: DatabaseHandle };

/** The application's shared database. Opened lazily on first use. */
export function getDb(): Database {
  globalForDb.__ptccDb ??= openDatabase(databaseOptionsFromEnv());
  return globalForDb.__ptccDb.db;
}
