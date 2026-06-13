CREATE TABLE "rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
