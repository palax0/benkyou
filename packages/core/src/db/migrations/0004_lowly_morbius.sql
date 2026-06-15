DROP INDEX IF EXISTS "items_search_vec_idx";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN IF EXISTS "search_vec";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "search_vec" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title,'')),'A') || setweight(to_tsvector('simple', coalesce(summary,'')),'B') || setweight(to_tsvector('simple', left(coalesce(raw_content,''), 100000)),'C')) STORED;--> statement-breakpoint
CREATE INDEX "items_search_vec_idx" ON "items" USING gin ("search_vec");
