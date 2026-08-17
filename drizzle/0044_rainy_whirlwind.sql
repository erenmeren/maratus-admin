DROP TABLE "credit_balance" CASCADE;--> statement-breakpoint
DROP TABLE "credit_ledger" CASCADE;--> statement-breakpoint
DROP TABLE "device_usage_month" CASCADE;--> statement-breakpoint
ALTER TABLE "device_command" DROP COLUMN "billing";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "billing_plan";