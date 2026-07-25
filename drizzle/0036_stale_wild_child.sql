ALTER TABLE "tenant_settings" ADD COLUMN "pinned_url" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "pinned_at" timestamp;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "pin_mode" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "pinned_url" text;--> statement-breakpoint
ALTER TABLE "store" ADD COLUMN "pinned_at" timestamp;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "pin_mode" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
UPDATE "device" SET "pin_mode" = 'custom' WHERE "pinned_url" IS NOT NULL;
