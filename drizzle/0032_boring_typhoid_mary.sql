CREATE TABLE "device_usage_month" (
	"device_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"month" text NOT NULL,
	"triggers" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "device_usage_month_device_id_month_pk" PRIMARY KEY("device_id","month")
);
--> statement-breakpoint
ALTER TABLE "device_command" ADD COLUMN "billing" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "billing_plan" text DEFAULT 'credits' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "included_triggers_per_device" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "stripe_subscription_item_id" text;--> statement-breakpoint
ALTER TABLE "device_usage_month" ADD CONSTRAINT "device_usage_month_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_usage_month" ADD CONSTRAINT "device_usage_month_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_usage_month_org_month_idx" ON "device_usage_month" USING btree ("organization_id","month");