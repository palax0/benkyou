CREATE TABLE "ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" uuid,
	"stage" text NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_fetch_error" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_item_idx" ON "ai_usage" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "items_updated_at_idx" ON "items" USING btree ("updated_at");