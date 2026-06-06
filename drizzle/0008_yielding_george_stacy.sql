CREATE TABLE "alert" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"notified_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "alert_open_key_idx" ON "alert" USING btree ("key") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "alert_status_idx" ON "alert" USING btree ("status","last_seen_at");