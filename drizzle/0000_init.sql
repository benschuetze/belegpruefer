CREATE TYPE "public"."booking_source" AS ENUM('regel', 'ki', 'manuell');--> statement-breakpoint
CREATE TYPE "public"."decision_role" AS ENUM('parser', 'extraktor', 'validator', 'recherche', 'kontierer', 'pruefer', 'entscheidung');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('xml', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('neu', 'verarbeitung', 'automatisch', 'pruefen', 'bestaetigt', 'festgeschrieben', 'fehler');--> statement-breakpoint
CREATE TYPE "public"."review_result" AS ENUM('ok', 'korrigiert');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"account" text NOT NULL,
	"contra_account" text NOT NULL,
	"tax_key" text NOT NULL,
	"text" text NOT NULL,
	"reference" text NOT NULL,
	"source" "booking_source" NOT NULL,
	"locked_at" timestamp with time zone,
	"reversal_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"role" "decision_role" NOT NULL,
	"model" text,
	"prompt_version" text,
	"input_jsonb" jsonb,
	"output_jsonb" jsonb,
	"confidence" real,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_microcents" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"storage_key" text DEFAULT 'db' NOT NULL,
	"content_base64" text,
	"sha256" text NOT NULL,
	"status" "document_status" DEFAULT 'neu' NOT NULL,
	"extracted_jsonb" jsonb,
	"findings_jsonb" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_tenant_sha256" UNIQUE("tenant_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"file_key" text NOT NULL,
	"booking_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_hash" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"user_label" text NOT NULL,
	"result" "review_result" NOT NULL,
	"before_jsonb" jsonb,
	"after_jsonb" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ust_id" text,
	"country" text,
	"profile_jsonb" jsonb,
	"profile_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_tenant_name" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kontenrahmen" text DEFAULT 'SKR03' NOT NULL,
	"berater_nr" integer NOT NULL,
	"mandanten_nr" integer NOT NULL,
	"fiscal_year_start_month" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_tenant_document" ON "bookings" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "bookings_tenant_date" ON "bookings" USING btree ("tenant_id","booking_date");--> statement-breakpoint
CREATE INDEX "decisions_tenant_document" ON "decisions" USING btree ("tenant_id","document_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_tenant_status" ON "documents" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "exports_tenant_created" ON "exports" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_time" ON "login_attempts" USING btree ("ip_hash","attempted_at");--> statement-breakpoint
CREATE INDEX "reviews_tenant_document" ON "reviews" USING btree ("tenant_id","document_id");