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
  DEFAULT_EMBED_REQUEST_DIMENSIONS: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),

  DEFAULT_WHISPER_BASE_URL: z.string().optional(),
  DEFAULT_WHISPER_API_KEY: z.string().optional(),
  DEFAULT_WHISPER_MODEL: z.string().optional(),

  POTOKEN_PROVIDER_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof Schema>;

// Treat empty-string env vars as unset so zod `.default()` applies.
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== ''),
);

const parsed = Schema.safeParse(rawEnv);

// Importing this module is side-effect-free: it never throws. A shared library
// must not crash just because it's imported without secrets present — `next
// build` collects page data by evaluating server modules that transitively
// import this one, and tooling may import it indirectly. Each *process* instead
// calls assertEnv() at startup to fail-fast on misconfiguration.
// See docs/dev/env-and-monorepo.md.
export const env: Env = (parsed.success ? parsed.data : rawEnv) as Env;

export function assertEnv(): void {
  if (parsed.success) return;
  // zod 4 renamed `error.errors` to `error.issues`
  const message = parsed.error.issues
    .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
    .join('\n');
  throw new Error(`Invalid environment:\n${message}`);
}
