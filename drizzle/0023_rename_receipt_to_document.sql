ALTER TABLE "receipt" RENAME TO "document";--> statement-breakpoint
ALTER TABLE "document" RENAME CONSTRAINT "receipt_token_unique" TO "document_token_unique";--> statement-breakpoint
ALTER TABLE "document" RENAME CONSTRAINT "receipt_organization_id_organization_id_fk" TO "document_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "document" RENAME CONSTRAINT "receipt_device_id_device_id_fk" TO "document_device_id_device_id_fk";--> statement-breakpoint
ALTER TABLE "document" RENAME CONSTRAINT "receipt_store_id_store_id_fk" TO "document_store_id_store_id_fk";--> statement-breakpoint
ALTER INDEX "receipt_token_idx" RENAME TO "document_token_idx";--> statement-breakpoint
ALTER INDEX "receipt_organization_id_idx" RENAME TO "document_organization_id_idx";--> statement-breakpoint
ALTER INDEX "receipt_device_id_idx" RENAME TO "document_device_id_idx";--> statement-breakpoint
ALTER INDEX "receipt_store_id_idx" RENAME TO "document_store_id_idx";--> statement-breakpoint
ALTER INDEX "receipt_created_at_idx" RENAME TO "document_created_at_idx";--> statement-breakpoint
ALTER TABLE "usage_event" RENAME COLUMN "receipt_id" TO "document_id";--> statement-breakpoint
ALTER TABLE "usage_event" RENAME CONSTRAINT "usage_event_receipt_id_receipt_id_fk" TO "usage_event_document_id_document_id_fk";--> statement-breakpoint
ALTER INDEX "usage_event_receipt_id_idx" RENAME TO "usage_event_document_id_idx";--> statement-breakpoint
ALTER TABLE "invoice" RENAME COLUMN "receipt_count" TO "document_count";
