CREATE TABLE "firmware_release" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"r2_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "firmware_release_version_unique" UNIQUE("version")
);
