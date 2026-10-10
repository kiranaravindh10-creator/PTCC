import { defineConfig } from "drizzle-kit";

// Migrations are generated from the TypeScript schema and committed as SQL.
// Applying them is done by `npm run db:migrate` (scripts/db-migrate.ts), which
// works for both PGlite (development) and PostgreSQL (production).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
  strict: true,
  verbose: true,
});
