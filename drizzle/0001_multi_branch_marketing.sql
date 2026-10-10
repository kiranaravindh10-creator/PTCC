CREATE TABLE "access_defaults_applied" (
	"role_key" text NOT NULL,
	"permission_key" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_defaults_applied_role_key_permission_key_pk" PRIMARY KEY("role_key","permission_key")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address_line" text,
	"city" text,
	"state" text,
	"pincode" text,
	"phone" text,
	"email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"verification" text DEFAULT 'needs_verification' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "branches_status_check" CHECK ("branches"."status" in ('active', 'inactive')),
	CONSTRAINT "branches_verification_check" CHECK ("branches"."verification" in ('verified', 'needs_verification'))
);
--> statement-breakpoint
CREATE TABLE "company_branches" (
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"relationship" text DEFAULT 'prospect' NOT NULL,
	"owner_id" uuid,
	"became_customer_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "company_branches_company_id_branch_id_pk" PRIMARY KEY("company_id","branch_id"),
	CONSTRAINT "company_branches_relationship_check" CHECK ("company_branches"."relationship" in ('prospect', 'customer', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "accreditations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certificate_number" text NOT NULL,
	"branch_id" uuid,
	"branch_link_status" text DEFAULT 'needs_verification' NOT NULL,
	"accreditation_body" text NOT NULL,
	"standard" text,
	"field" text,
	"legal_entity" text,
	"facility_address" text,
	"issue_date" date,
	"valid_from" date,
	"valid_until" date,
	"last_amended_on" date,
	"scope_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accreditations_branch_link_check" CHECK ("accreditations"."branch_link_status" in ('confirmed', 'needs_verification'))
);
--> statement-breakpoint
CREATE TABLE "scope_disciplines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"sha256" text NOT NULL,
	"generator" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_by" uuid,
	CONSTRAINT "scope_documents_kind_check" CHECK ("scope_documents"."kind" in ('scope', 'certificates'))
);
--> statement-breakpoint
CREATE TABLE "scope_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accreditation_id" uuid NOT NULL,
	"scope_document_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"facility_type" text NOT NULL,
	"serial_number" integer NOT NULL,
	"measurand_or_instrument" text NOT NULL,
	"method" text NOT NULL,
	"range_text" text NOT NULL,
	"cmc_text" text NOT NULL,
	"pdf_page" integer NOT NULL,
	"annexure_page" integer,
	"raw" jsonb NOT NULL,
	"search_text" text NOT NULL,
	"search_compact" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scope_entries_facility_check" CHECK ("scope_entries"."facility_type" in ('permanent', 'site'))
);
--> statement-breakpoint
CREATE TABLE "scope_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discipline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "activities_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"company_id" uuid NOT NULL,
	"lead_id" uuid,
	"contact_id" uuid,
	"branch_id" uuid,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"call_outcome" text,
	"body" text,
	"meta" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_kind_check" CHECK ("activities"."kind" in ('call', 'note', 'lead_created', 'stage_changed', 'assigned', 'branch_assigned', 'follow_up_scheduled', 'follow_up_done', 'requirement_added', 'quotation_created', 'quotation_status', 'won', 'lost', 'reopened', 'customer_linked')),
	CONSTRAINT "activities_call_outcome_check" CHECK ("activities"."call_outcome" is null or "activities"."call_outcome" in ('connected', 'no_answer', 'busy', 'switched_off', 'wrong_number')),
	CONSTRAINT "activities_call_needs_outcome_check" CHECK ("activities"."kind" <> 'call' or "activities"."call_outcome" is not null)
);
--> statement-breakpoint
CREATE TABLE "lead_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"scope_entry_id" uuid,
	"description" text NOT NULL,
	"quantity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "lead_requirements_quantity_check" CHECK ("lead_requirements"."quantity" is null or "lead_requirements"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "leads_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1),
	"branch_id" uuid,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"requirement" text NOT NULL,
	"source" text DEFAULT 'employee' NOT NULL,
	"capture_method" text DEFAULT 'manual' NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_id" uuid,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone,
	"captured_by" uuid NOT NULL,
	"won_value_paise" bigint,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"lost_reason" text,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "leads_stage_check" CHECK ("leads"."stage" in ('new', 'qualification', 'contact', 'follow_up', 'requirement', 'quotation', 'won', 'lost')),
	CONSTRAINT "leads_source_check" CHECK ("leads"."source" in ('employee', 'phone_enquiry', 'email_enquiry', 'walk_in', 'referral', 'existing_customer', 'website', 'other')),
	CONSTRAINT "leads_capture_method_check" CHECK ("leads"."capture_method" in ('manual', 'photo', 'voice', 'text')),
	CONSTRAINT "leads_won_check" CHECK ("leads"."stage" <> 'won' or "leads"."won_at" is not null),
	CONSTRAINT "leads_lost_check" CHECK ("leads"."stage" <> 'lost' or ("leads"."lost_at" is not null and "leads"."lost_reason" is not null)),
	CONSTRAINT "leads_won_value_check" CHECK ("leads"."won_value_paise" is null or "leads"."won_value_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"scope_entry_id" uuid,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"amount_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_lines_quantity_check" CHECK ("quotation_lines"."quantity" > 0),
	CONSTRAINT "quotation_lines_amount_check" CHECK ("quotation_lines"."unit_price_paise" >= 0 and "quotation_lines"."amount_paise" = "quotation_lines"."unit_price_paise" * "quotation_lines"."quantity")
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "quotations_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1),
	"branch_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"valid_until" date,
	"notes" text,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "quotations_status_check" CHECK ("quotations"."status" in ('draft', 'sent', 'accepted', 'rejected')),
	CONSTRAINT "quotations_total_check" CHECK ("quotations"."total_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT "companies_lifecycle_check";--> statement-breakpoint
DROP INDEX "companies_name_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
-- Hand-edited: NOT NULL columns are added nullable, backfilled, then constrained, so this
-- migration is safe on databases that already hold Phase 1 data.
ALTER TABLE "companies" ADD COLUMN "normalized_name" text;--> statement-breakpoint
UPDATE "companies" SET "normalized_name" = trim(regexp_replace(lower(replace("name", '&', ' and ')), '[^a-z0-9]+', ' ', 'g'));--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "normalized_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- Records created before branches existed are placed in a clearly labelled branch, created
-- only when such records exist. An administrator renames it or moves its records — the
-- migration never guesses which real branch they belong to.
INSERT INTO "branches" ("name", "status", "verification", "notes")
SELECT 'Unassigned (created before branches)', 'active', 'needs_verification',
       'Created by the Phase 2 migration for records that existed before branches. Rename it or move its records to the right branch.'
WHERE EXISTS (SELECT 1 FROM "tasks") OR EXISTS (SELECT 1 FROM "companies");--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
UPDATE "tasks" SET "branch_id" = (SELECT "id" FROM "branches" WHERE "name" = 'Unassigned (created before branches)');--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
UPDATE "users" SET "branch_id" = (SELECT "id" FROM "branches" WHERE "name" = 'Unassigned (created before branches)')
WHERE EXISTS (
  SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id"
  WHERE ur."user_id" = "users"."id" AND r."key" NOT IN ('ceo', 'admin')
);--> statement-breakpoint
INSERT INTO "company_branches" ("company_id", "branch_id", "relationship", "owner_id", "became_customer_at", "created_at", "updated_at")
SELECT c."id", b."id",
       CASE WHEN c."lifecycle" IN ('prospect', 'customer', 'inactive') THEN c."lifecycle" ELSE 'prospect' END,
       c."owner_id",
       CASE WHEN c."lifecycle" = 'customer' THEN c."updated_at" END,
       c."created_at", c."updated_at"
FROM "companies" c CROSS JOIN "branches" b
WHERE b."name" = 'Unassigned (created before branches)';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_branches" ADD CONSTRAINT "company_branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_branches" ADD CONSTRAINT "company_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_branches" ADD CONSTRAINT "company_branches_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_branches" ADD CONSTRAINT "company_branches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_branches" ADD CONSTRAINT "company_branches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accreditations" ADD CONSTRAINT "accreditations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accreditations" ADD CONSTRAINT "accreditations_scope_document_id_scope_documents_id_fk" FOREIGN KEY ("scope_document_id") REFERENCES "public"."scope_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_documents" ADD CONSTRAINT "scope_documents_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_entries" ADD CONSTRAINT "scope_entries_accreditation_id_accreditations_id_fk" FOREIGN KEY ("accreditation_id") REFERENCES "public"."accreditations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_entries" ADD CONSTRAINT "scope_entries_scope_document_id_scope_documents_id_fk" FOREIGN KEY ("scope_document_id") REFERENCES "public"."scope_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_entries" ADD CONSTRAINT "scope_entries_group_id_scope_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."scope_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_groups" ADD CONSTRAINT "scope_groups_discipline_id_scope_disciplines_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "public"."scope_disciplines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_requirements" ADD CONSTRAINT "lead_requirements_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_requirements" ADD CONSTRAINT "lead_requirements_scope_entry_id_scope_entries_id_fk" FOREIGN KEY ("scope_entry_id") REFERENCES "public"."scope_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_requirements" ADD CONSTRAINT "lead_requirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_scope_entry_id_scope_entries_id_fk" FOREIGN KEY ("scope_entry_id") REFERENCES "public"."scope_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_name_unique" ON "branches" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "company_branches_branch_idx" ON "company_branches" USING btree ("branch_id","relationship");--> statement-breakpoint
CREATE UNIQUE INDEX "accreditations_certificate_unique" ON "accreditations" USING btree ("certificate_number");--> statement-breakpoint
CREATE UNIQUE INDEX "scope_disciplines_name_unique" ON "scope_disciplines" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "scope_documents_sha256_unique" ON "scope_documents" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "scope_entries_source_row_unique" ON "scope_entries" USING btree ("scope_document_id","accreditation_id","facility_type","serial_number");--> statement-breakpoint
CREATE INDEX "scope_entries_accreditation_idx" ON "scope_entries" USING btree ("accreditation_id","is_current");--> statement-breakpoint
CREATE INDEX "scope_entries_group_idx" ON "scope_entries" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scope_groups_discipline_name_unique" ON "scope_groups" USING btree ("discipline_id","name");--> statement-breakpoint
CREATE INDEX "activities_company_idx" ON "activities" USING btree ("company_id","seq");--> statement-breakpoint
CREATE INDEX "activities_lead_idx" ON "activities" USING btree ("lead_id","seq");--> statement-breakpoint
CREATE INDEX "activities_branch_kind_idx" ON "activities" USING btree ("branch_id","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_actor_idx" ON "activities" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lead_requirements_lead_idx" ON "lead_requirements" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "leads_branch_stage_idx" ON "leads" USING btree ("branch_id","stage");--> statement-breakpoint
CREATE INDEX "leads_owner_stage_idx" ON "leads" USING btree ("owner_id","stage");--> statement-breakpoint
CREATE INDEX "leads_company_idx" ON "leads" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "leads_captured_by_idx" ON "leads" USING btree ("captured_by");--> statement-breakpoint
CREATE INDEX "quotation_lines_quotation_idx" ON "quotation_lines" USING btree ("quotation_id","position");--> statement-breakpoint
CREATE INDEX "quotations_lead_idx" ON "quotations" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "quotations_branch_status_idx" ON "quotations" USING btree ("branch_id","status");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_branch_idx" ON "users" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "companies_normalized_name_idx" ON "companies" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "tasks_branch_status_idx" ON "tasks" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "tasks_lead_idx" ON "tasks" USING btree ("lead_id");