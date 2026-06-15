ALTER TABLE "items" ADD COLUMN "content_md" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "extract_status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "reader_base_url" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "reader_api_key" text;