DROP TABLE "document" CASCADE;--> statement-breakpoint
DROP TABLE "invoice" CASCADE;--> statement-breakpoint
DROP TABLE "usage_event" CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "per_print_price_cents";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "stripe_subscription_id";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "subscription_status";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "card_brand";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "card_last4";