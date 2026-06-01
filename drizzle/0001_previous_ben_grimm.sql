ALTER TABLE "invoice" ADD COLUMN "stripe_invoice_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "hosted_invoice_url" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "card_brand" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "card_last4" text;