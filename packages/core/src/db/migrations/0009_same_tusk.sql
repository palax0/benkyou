CREATE TABLE "platform_credentials" (
	"platform" text PRIMARY KEY NOT NULL,
	"secret" text,
	"meta" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
