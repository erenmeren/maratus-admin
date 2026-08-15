CREATE TABLE "invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"device_count" integer,
	"device_id" text,
	"triggers_used" integer,
	"triggers_included" integer,
	"overage_triggers" integer,
	"credits_consumed" integer,
	"amount_usd_cents" integer NOT NULL,
	"try_amount_kurus" integer,
	"fx_rate" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"issued_at" timestamp NOT NULL,
	"due_at" timestamp NOT NULL,
	"paid_at" timestamp,
	"marked_paid_by_user_id" text,
	"note" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ALTER COLUMN "included_triggers_per_device" SET DEFAULT 1000;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "subscription_paid_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "subscription_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "subscription_renews_at" timestamp;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "price_per_device_cents" integer DEFAULT 1500 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "overage_price_cents" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "legacy_credits_remaining" integer;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_org_kind_period_idx" ON "invoice" USING btree ("organization_id","kind","period_start");--> statement-breakpoint
CREATE INDEX "invoice_org_issued_idx" ON "invoice" USING btree ("organization_id","issued_at");--> statement-breakpoint
CREATE INDEX "invoice_status_due_idx" ON "invoice" USING btree ("status","due_at");