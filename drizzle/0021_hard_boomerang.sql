ALTER TABLE "tenant_settings" ADD COLUMN "qr_visible_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "screen_brightness" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "screen_sleep_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "screen_sleep_timeout_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "device_settings_password_hash" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "device_settings_password_salt" text;