CREATE TABLE "lead_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"captured_by" uuid NOT NULL,
	"branch_id" uuid,
	"method" text NOT NULL,
	"language" text DEFAULT 'unknown' NOT NULL,
	"provider" text NOT NULL,
	"simulated" boolean NOT NULL,
	"sample" text,
	"media_type" text,
	"media_bytes" integer,
	"media_sha256" text,
	"original_text" text,
	"edited_text" text,
	"draft" jsonb,
	"problems" jsonb,
	"edited_fields" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"error" text,
	"lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	CONSTRAINT "lead_captures_method_check" CHECK ("lead_captures"."method" in ('photo', 'voice', 'text')),
	CONSTRAINT "lead_captures_language_check" CHECK ("lead_captures"."language" in ('en', 'kn', 'hi', 'unknown')),
	CONSTRAINT "lead_captures_status_check" CHECK ("lead_captures"."status" in ('draft', 'confirmed', 'discarded', 'failed')),
	CONSTRAINT "lead_captures_confirmed_check" CHECK ("lead_captures"."status" <> 'confirmed' or "lead_captures"."lead_id" is not null),
	CONSTRAINT "lead_captures_media_bytes_check" CHECK ("lead_captures"."media_bytes" is null or "lead_captures"."media_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "lead_captures" ADD CONSTRAINT "lead_captures_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_captures" ADD CONSTRAINT "lead_captures_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_captures" ADD CONSTRAINT "lead_captures_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_captures_lead_unique" ON "lead_captures" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_captures_captured_by_idx" ON "lead_captures" USING btree ("captured_by","created_at");--> statement-breakpoint
CREATE INDEX "lead_captures_status_idx" ON "lead_captures" USING btree ("status","created_at");