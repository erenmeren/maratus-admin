DROP TABLE "document_contact" CASCADE;--> statement-breakpoint
DROP TABLE "lookup_token" CASCADE;--> statement-breakpoint
DROP TABLE "marketing_contact" CASCADE;--> statement-breakpoint
DROP TABLE "webhook_delivery" CASCADE;--> statement-breakpoint
DROP TABLE "webhook_endpoint" CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "support_email";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "support_url";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "return_window_days";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "warranty_period_months";