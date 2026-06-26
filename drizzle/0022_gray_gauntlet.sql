CREATE TABLE "api_idempotency" (
	"key" text NOT NULL,
	"organization_id" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"command_id" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "api_idempotency_key_organization_id_pk" PRIMARY KEY("key","organization_id")
);
--> statement-breakpoint
CREATE TABLE "credit_balance" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"available" integer DEFAULT 0 NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"device_id" text,
	"kind" text NOT NULL,
	"credits" integer NOT NULL,
	"action" text,
	"command_id" text,
	"idempotency_key" text,
	"balance_after_available" integer,
	"note" text,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "scopes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "api_key" SET "scopes" = ARRAY['receipts:read','usage:read'] WHERE "scopes" = '{}'::text[];--> statement-breakpoint
ALTER TABLE "device_command" ADD COLUMN "action" text;--> statement-breakpoint
ALTER TABLE "device_command" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "device_command" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "api_idempotency" ADD CONSTRAINT "api_idempotency_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balance" ADD CONSTRAINT "credit_balance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_org_created_idx" ON "credit_ledger" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_device_created_idx" ON "credit_ledger" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_command_idx" ON "credit_ledger" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_kind_idem_idx" ON "credit_ledger" USING btree ("kind","idempotency_key") WHERE "credit_ledger"."idempotency_key" is not null;