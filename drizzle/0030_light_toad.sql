CREATE TABLE "factory_device" (
	"serial" text PRIMARY KEY NOT NULL,
	"batch_code" text,
	"hardware_revision" text,
	"status" text DEFAULT 'manufactured' NOT NULL,
	"allocated_organization_id" text,
	"allocated_store_id" text,
	"device_id" text,
	"unregistered" boolean DEFAULT false NOT NULL,
	"manufactured_at" timestamp,
	"imported_at" timestamp NOT NULL,
	"allocated_at" timestamp,
	"claimed_at" timestamp,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "serial" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "serial_conflict" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_device" ADD CONSTRAINT "factory_device_allocated_organization_id_organization_id_fk" FOREIGN KEY ("allocated_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_device" ADD CONSTRAINT "factory_device_allocated_store_id_store_id_fk" FOREIGN KEY ("allocated_store_id") REFERENCES "public"."store"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_device" ADD CONSTRAINT "factory_device_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "factory_device_status_idx" ON "factory_device" USING btree ("status");--> statement-breakpoint
CREATE INDEX "factory_device_allocated_org_idx" ON "factory_device" USING btree ("allocated_organization_id");--> statement-breakpoint
CREATE INDEX "factory_device_device_id_idx" ON "factory_device" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_serial_idx" ON "device" USING btree ("serial");