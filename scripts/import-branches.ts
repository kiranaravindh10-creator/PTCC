/**
 * Registers PTCC's branches from the branch directory supplied by PTCC (contact details only;
 * accreditation comes from the scope import).
 *
 *   npm run branches:import                          # data/branches/ptcc-branches.json
 *
 * Safe to run repeatedly: creates missing branches and fills empty fields; never overwrites.
 */
import fs from "node:fs";
import path from "node:path";
import { importBranchDirectory } from "@/modules/branches/import";
import { arg, run, withDatabase } from "./_shared";

run(async () => {
  const file = path.resolve(arg("file") ?? "data/branches/ptcc-branches.json");
  const directory = JSON.parse(fs.readFileSync(file, "utf8"));
  await withDatabase(async ({ db }) => {
    const result = await importBranchDirectory(db, directory);
    if (result.created.length) console.log(`✓ Branches added: ${result.created.join(", ")}`);
    if (result.updated.length) console.log(`✓ Empty details filled in for: ${result.updated.join(", ")}`);
    if (result.unchanged.length) console.log(`✓ Already registered: ${result.unchanged.join(", ")}`);
  });
});
