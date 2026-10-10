/**
 * Development only: deletes the local PGlite database and rebuilds it with sample data.
 * Refuses to touch a PostgreSQL DATABASE_URL. Usage: npm run db:reset
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import { databaseOptionsFromEnv } from "@/server/db/client";
import { lockPathFor, pgliteLockHolder } from "@/server/db/pglite-lock";
import { loadEnv, run } from "./_shared";

run(async () => {
  loadEnv();
  const options = databaseOptionsFromEnv();
  if (options.driver !== "pglite" || !options.dataDir) {
    throw new Error("db:reset only works on the local development database (PGlite). It never touches DATABASE_URL.");
  }
  const holder = pgliteLockHolder(options.dataDir);
  if (holder !== null) {
    throw new Error(`The local database is in use (pid ${holder}). Stop \`npm run dev\` first.`);
  }
  fs.rmSync(options.dataDir, { recursive: true, force: true });
  fs.rmSync(lockPathFor(options.dataDir), { force: true });
  console.log(`Removed ${options.dataDir}`);
  for (const script of ["db:migrate", "db:sync-access", "scope:import", "branches:import", "db:seed"]) {
    execSync(`npm run --silent ${script}`, { stdio: "inherit" });
  }
});
