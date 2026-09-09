ALTER TABLE "device_command" DROP CONSTRAINT "device_command_device_id_device_id_fk";
--> statement-breakpoint
ALTER TABLE "device_command" ALTER COLUMN "device_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "pending_device_slots" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "pending_slots_at" timestamp;--> statement-breakpoint
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;