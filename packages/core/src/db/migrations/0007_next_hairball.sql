ALTER TABLE "ai_usage" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "conversation_id" uuid;