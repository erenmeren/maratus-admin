CREATE TABLE "usage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"stripe_customer_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"reported_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_receipt_id_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_event_receipt_id_idx" ON "usage_event" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "usage_event_status_created_idx" ON "usage_event" USING btree ("status","created_at");