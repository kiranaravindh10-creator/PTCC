/** Applies pending SQL migrations from drizzle/. Usage: npm run db:migrate */
import { runMigrations } from "@/server/db/migrate";
import { run, withDatabase } from "./_shared";

run(async () => {
  await withDatabase(async (handle) => {
    console.log(`Applying migrations (${handle.driver})…`);
    await runMigrations(handle);
    console.log("✓ Database schema is up to date.");
  });
});
