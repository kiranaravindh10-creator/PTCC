/**
 * Creates the first administrator on a fresh installation.
 *
 *   npm run admin:create -- --name "Deepa Nair" --phone 9876543210 [--email deepa@example.com]
 *
 * Prints a temporary password; the person must choose their own at first sign-in.
 */
import { eq } from "drizzle-orm";
import { generateTemporaryPassword, hashPassword } from "@/server/auth/password";
import { writeAudit } from "@/server/audit";
import { roles, userRoles, users } from "@/server/db/schema";
import { normalizePhone } from "@/lib/phone";
import { arg, run, withDatabase } from "./_shared";

run(async () => {
  const name = arg("name")?.trim();
  const phone = normalizePhone(arg("phone") ?? "");
  const email = arg("email")?.trim().toLowerCase() || null;
  if (!name || !phone) {
    throw new Error('Usage: npm run admin:create -- --name "Full Name" --phone 9876543210 [--email you@example.com]');
  }

  await withDatabase(async ({ db }) => {
    const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "admin")).limit(1);
    if (!adminRole) throw new Error("Roles are not set up yet. Run `npm run db:setup` first.");

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    if (existing) throw new Error("A person with that phone number already exists.");

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ name, phone, email, passwordHash, mustChangePassword: true, designation: "Administrator" })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({ userId: user!.id, roleId: adminRole.id });
      await writeAudit(tx, {
        actorId: null,
        action: "user.create",
        entityType: "user",
        entityId: user!.id,
        summary: `Bootstrap administrator ${name} created from the command line`,
      });
    });

    console.log(`✓ Administrator created: ${name} (${phone})`);
    console.log(`  Temporary password: ${temporaryPassword}`);
    console.log("  They will be asked to choose their own password at first sign-in.");
  });
});
