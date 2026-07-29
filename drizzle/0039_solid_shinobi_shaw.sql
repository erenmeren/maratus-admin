CREATE TABLE "mqtt_webhook_ping" (
	"channel" text PRIMARY KEY NOT NULL,
	"last_at" timestamp NOT NULL,
	"last_device_id" text
);
