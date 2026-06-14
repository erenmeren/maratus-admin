ALTER TABLE "receipt" ALTER COLUMN "device_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "receipt" ADD COLUMN "source" text DEFAULT 'device' NOT NULL;--> statement-breakpoint
ALTER TABLE "receipt" ADD COLUMN "metadata" jsonb;