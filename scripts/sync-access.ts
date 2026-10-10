/**
 * Syncs the permission catalogue and system roles from code into the database.
 * Safe to run on every deployment. Usage: npm run db:sync-access
 */
import { syncAccess } from "@/server/access/sync";
import { run, withDatabase } from "./_shared";

run(async () => {
  await withDatabase(async ({ db }) => {
    const result = await syncAccess(db);
    console.log(`✓ ${result.permissionsUpserted} permissions in sync`);
    if (result.permissionsRemoved > 0) console.log(`  removed ${result.permissionsRemoved} retired permission(s)`);
    if (result.rolesCreated.length > 0) console.log(`  created roles: ${result.rolesCreated.join(", ")}`);
  });
});
