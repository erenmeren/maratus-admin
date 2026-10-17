ALTER TABLE "device" ADD COLUMN "last_rssi" integer;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "link_drops" integer;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "link_kicks" integer;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "last_reset_reason" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ALTER COLUMN "included_triggers_per_device" SET DEFAULT 30000;--> statement-breakpoint
-- Quota is 30,000 per slot per monthly period (1,000/day × 30), not 1,000/month.
UPDATE "tenant_settings" SET "included_triggers_per_device" = 30000 WHERE "included_triggers_per_device" = 1000;
