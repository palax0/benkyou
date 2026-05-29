CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "digest_items" (
	"digest_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"category" text NOT NULL,
	"rank" integer NOT NULL,
	"reason" text,
	CONSTRAINT "digest_items_digest_id_item_id_pk" PRIMARY KEY("digest_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"intro_text" text,
	"generated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "digests_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "event_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_item" uuid,
	"keywords" text[],
	"first_seen_at" timestamp with time zone DEFAULT now(),
	"last_updated_at" timestamp with time zone DEFAULT now(),
	"item_count" integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE "item_embeddings" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"embedding" vector(1536),
	"title_emb" vector(1536),
	"model_id" text
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"external_id" text,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"published_at" timestamp with time zone,
	"content_type" text NOT NULL,
	"raw_content" text,
	"transcript_status" text DEFAULT 'na' NOT NULL,
	"transcript_segments" jsonb,
	"video_duration" integer,
	"video_kind" text,
	"summary" text,
	"deep_summary" text,
	"deep_summary_at" timestamp with time zone,
	"topic_tags" text[],
	"depth_score" numeric,
	"topic_score" numeric,
	"category" text,
	"cluster_id" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"current_stage" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"bookmarked" boolean DEFAULT false,
	"bookmarked_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now(),
	"search_vec" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title,'')),'A') || setweight(to_tsvector('simple', coalesce(summary,'')),'B') || setweight(to_tsvector('simple', coalesce(raw_content,'')),'C')) STORED
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"tool_result" jsonb,
	"referenced_items" uuid[],
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_used_at" timestamp with time zone DEFAULT now(),
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"weight" numeric DEFAULT '1.0',
	"enabled" boolean DEFAULT true,
	"poll_interval" integer DEFAULT 1800,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"password_hash" text NOT NULL,
	"locale" text DEFAULT 'zh' NOT NULL,
	"llm_provider" text,
	"llm_base_url" text,
	"llm_api_key" text,
	"llm_model" text,
	"llm_cheap_model" text,
	"embed_provider" text,
	"embed_base_url" text,
	"embed_api_key" text,
	"embed_model" text,
	"embed_dim" integer NOT NULL,
	"whisper_base_url" text,
	"whisper_api_key" text,
	"whisper_model" text,
	"interest_tags" text[],
	"weight_alpha" numeric DEFAULT '0.6',
	"weight_beta" numeric DEFAULT '0.3',
	"weight_gamma" numeric DEFAULT '0.1',
	"digest_count" integer DEFAULT 5,
	"video_auto_limit" integer DEFAULT 1800,
	"video_manual_limit" integer DEFAULT 10800,
	"adhoc_source_weight" numeric DEFAULT '1.0',
	"pipeline_max_attempts" integer DEFAULT 3,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_digest_id_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."digests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_embeddings" ADD CONSTRAINT "item_embeddings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_cluster_id_event_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."event_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_url_hash_uq" ON "items" USING btree ("url_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "items_source_ext_uq" ON "items" USING btree ("source_id","external_id") WHERE source_id IS NOT NULL AND external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "items_state_idx" ON "items" USING btree ("state");--> statement-breakpoint
CREATE INDEX "items_published_idx" ON "items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "items_source_idx" ON "items" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "items_bookmarked_idx" ON "items" USING btree ("bookmarked") WHERE bookmarked = true;--> statement-breakpoint
CREATE INDEX "items_search_vec_idx" ON "items" USING gin ("search_vec");--> statement-breakpoint
CREATE INDEX "msg_conv_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "item_emb_hnsw" ON "item_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "title_emb_hnsw" ON "item_embeddings" USING hnsw ("title_emb" vector_cosine_ops);