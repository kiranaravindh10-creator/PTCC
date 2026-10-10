ALTER TABLE "companies" DROP CONSTRAINT "companies_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "lifecycle";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "owner_id";