CREATE TABLE "device_command" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" text,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"delivered_at" timestamp,
	"acked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_command" ADD CONSTRAINT "device_command_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_command_device_status_idx" ON "device_command" USING btree ("device_id","status");