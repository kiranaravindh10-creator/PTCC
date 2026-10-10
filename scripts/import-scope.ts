/**
 * Imports PTCC's accredited scope (controlled reference data) into the database.
 *
 *   npm run scope:import                         # data/scope/ptcc-nabl-scope.json
 *   npm run scope:import -- --file other.json    # a newer amendment
 *
 * Safe to run repeatedly: a source document is imported once (by SHA-256).
 * See docs/SERVICE_CATALOGUE.md for how the file is produced and verified.
 */
import fs from "node:fs";
import path from "node:path";
import { importScope } from "@/modules/catalogue/import";
import { arg, run, withDatabase } from "./_shared";

run(async () => {
  const file = path.resolve(arg("file") ?? "data/scope/ptcc-nabl-scope.json");
  const branchFile = path.resolve(arg("branches") ?? "data/scope/branches.json");
  const scope = JSON.parse(fs.readFileSync(file, "utf8"));
  const branchMap = JSON.parse(fs.readFileSync(branchFile, "utf8"));

  await withDatabase(async ({ db }) => {
    const result = await importScope(db, { scope, branchMap });
    if (result.document === "unchanged") {
      console.log(`✓ Scope already imported (${path.basename(file)}); accreditation details and branch links refreshed.`);
    } else {
      console.log(`✓ Imported ${result.entriesImported} scope entries for ${result.accreditations} accreditation(s).`);
      if (result.entriesRetired > 0) console.log(`  ${result.entriesRetired} entries from an earlier version marked not current.`);
    }
    if (result.branchesCreated.length) console.log(`  Branches created from certificates: ${result.branchesCreated.join(", ")}`);
    if (result.needsVerification.length) {
      console.log(`  ⚠ No confirmed branch for: ${result.needsVerification.join(", ")} — marked "needs verification".`);
    }
  });
});
