CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"last_used_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_hash_idx" ON "api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_key_organization_id_idx" ON "api_key" USING btree ("organization_id");