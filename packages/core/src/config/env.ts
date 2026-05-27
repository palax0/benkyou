import { z } from 'zod';

const Schema = z.object({
  DEPLOY_MODE: z.enum(['docker', 'serverless']).default('docker'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters'),
  EMBED_DIM: z.coerce.number().int().positive(),
  PORT: z.coerce.number().int().positive().default(3000),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  INITIAL_PASSWORD: z.string().optional(),

  DEFAULT_LLM_PROVIDER: z.string().optional(),
  DEFAULT_LLM_BASE_URL: z.string().optional(),
  DEFAULT_LLM_API_KEY: z.string().optional(),
  DEFAULT_LLM_MODEL: z.string().optional(),
  DEFAULT_LLM_CHEAP_MODEL: z.string().optional(),

  DEFAULT_EMBED_PROVIDER: z.string().optional(),
  DEFAULT_EMBED_BASE_URL: z.string().optional(),
  DEFAULT_EMBED_API_KEY: z.string().optional(),
  DEFAULT_EMBED_MODEL: z.string().optional(),

  DEFAULT_WHISPER_BASE_URL: z.string().optional(),
  DEFAULT_WHISPER_API_KEY: z.string().optional(),
  DEFAULT_WHISPER_MODEL: z.string().optional(),
});

export type Env = z.infer<typeof Schema>;

// Treat empty-string env vars as unset so zod `.default()` applies.
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== ''),
);

const parsed = Schema.safeParse(rawEnv);
if (!parsed.success) {
  // zod 4 renamed `error.errors` to `error.issues`
  const message = parsed.error.issues
    .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
    .join('\n');
  throw new Error(`Invalid environment:\n${message}`);
}

export const env: Env = parsed.data;
