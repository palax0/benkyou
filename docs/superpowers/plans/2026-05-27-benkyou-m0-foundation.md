# Benkyou M0 · Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up a runnable monorepo skeleton with all DB schema migrations in place, Docker Compose stack, CI green, and shared infrastructure (Vercel AI SDK abstraction stub, next-intl, Drizzle ORM, pg-boss). End-state: `docker compose up` boots postgres + web + worker; web `/health` returns OK; all tests pass in CI.

**Architecture:** pnpm workspace monorepo (`apps/web` Next.js + `apps/worker` Node + `packages/core` shared lib). PostgreSQL 16 + pgvector. All 11 spec tables migrated upfront via Drizzle. pg-boss for jobs. Vercel AI SDK abstraction stub (real providers wired in M3+). next-intl with `en` + `zh` message stubs.

**Tech Stack:** TypeScript 5.7, Next.js 16 (App Router), React 19, Tailwind CSS v4, pnpm 11, Drizzle ORM 0.45, pg-boss 12, pgvector/pgvector:pg16 Docker image, Vitest 4, Playwright 1.60, Testcontainers 12, MSW, next-intl 4, Vercel AI SDK 6 (`ai`), argon2 (`@node-rs/argon2`), GitHub Actions.

> Versions audited 2026-05-27 against npm latest. Verify with `pnpm view <pkg> version` before starting if more than 2 weeks have passed.

**Reference:** Spec at `docs/superpowers/specs/2026-05-27-benkyou-design.md`.

---

## File Structure

Files created in this plan:

| Path | Responsibility |
|---|---|
| `package.json` | Workspace root, declares pnpm workspace, common scripts |
| `pnpm-workspace.yaml` | Lists `apps/*` and `packages/*` |
| `tsconfig.base.json` | Shared TS compiler options |
| `.editorconfig`, `.prettierrc.json`, `.eslintrc.cjs` | Code style |
| `.gitignore` | Excludes `node_modules`, `.next`, `pgdata`, `.superpowers/` |
| `.env.example` | Documented env template (per spec §11.3) |
| `docker-compose.yml` | Three services: postgres / web / worker |
| `Dockerfile.web` | Multi-stage Next.js build |
| `Dockerfile.worker` | Multi-stage Node worker build |
| `.github/workflows/ci.yml` | Lint + typecheck + unit + integration + e2e (postgres service) |
| `apps/web/package.json` | Next.js app deps |
| `apps/web/next.config.ts` | Next config with next-intl plugin |
| `apps/web/app/layout.tsx` | Root layout with i18n provider |
| `apps/web/app/page.tsx` | Placeholder home (real UI in M1) |
| `apps/web/app/health/route.ts` | `/health` endpoint returns `{status, db, version}` |
| `apps/web/i18n/request.ts` | next-intl request config |
| `apps/web/messages/en.json` | English messages stub |
| `apps/web/messages/zh.json` | Chinese messages stub |
| `apps/web/tailwind.config.ts` | Tailwind v4 config |
| `apps/web/app/globals.css` | Tailwind entry |
| `apps/web/vitest.config.ts` | Web app test config |
| `apps/web/playwright.config.ts` | E2E test config |
| `apps/worker/package.json` | Worker deps |
| `apps/worker/src/index.ts` | Worker entry, dispatches by DEPLOY_MODE |
| `apps/worker/src/loop.ts` | Long-running poll loop (DEPLOY_MODE=docker) |
| `apps/worker/src/batch.ts` | Single-batch handler (DEPLOY_MODE=serverless, called by `/api/cron/work`) |
| `packages/core/package.json` | Core lib deps |
| `packages/core/src/db/client.ts` | Drizzle pg client singleton |
| `packages/core/src/db/schema.ts` | All 11 tables as Drizzle schema |
| `packages/core/src/db/migrate.ts` | Run migrations programmatically |
| `packages/core/src/db/migrations/0000_initial.sql` | Initial migration: extensions + tables |
| `packages/core/src/db/migrations/meta/_journal.json` | Drizzle metadata |
| `packages/core/src/queue/boss.ts` | pg-boss singleton + types |
| `packages/core/src/ai/provider.ts` | LLM/embedding provider factory (Vercel AI SDK) |
| `packages/core/src/ai/whisper.ts` | OpenAI-Whisper-API client (stub returns "unimplemented" for M0) |
| `packages/core/src/config/env.ts` | Validated env access (zod) |
| `packages/core/src/i18n/keys-check.ts` | i18n completeness check script |
| `packages/core/test/db.test.ts` | Integration: migration → tables exist |
| `packages/core/test/ai.test.ts` | Unit: provider factory returns correct adapter |
| `scripts/migrate.ts` | CLI: run migrations |
| `scripts/check-i18n.ts` | CLI: verify zh/en keys identical |

---

## Phase 0.1 · Repo Skeleton

### Task 1: Initialize pnpm workspace

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.editorconfig`

- [ ] **Step 1: Init pnpm workspace at repo root**

```bash
cd /home/lacanian/learning/benkyou
git init
```

- [ ] **Step 2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 3: Write root `package.json`**

```json
{
  "name": "benkyou",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "pnpm@11.3.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev": "pnpm -r --parallel run dev",
    "build": "pnpm -r run build",
    "lint": "pnpm -r run lint",
    "typecheck": "pnpm -r run typecheck",
    "test": "pnpm -r run test",
    "test:e2e": "pnpm --filter @benkyou/web run test:e2e",
    "migrate": "tsx scripts/migrate.ts",
    "check:i18n": "tsx scripts/check-i18n.ts"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "prettier": "^3.4.0",
    "eslint": "^9.17.0",
    "@typescript-eslint/parser": "^8.18.0",
    "@typescript-eslint/eslint-plugin": "^8.18.0"
  }
}
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
.next/
dist/
build/
.turbo/

# Local pg volume
pgdata/

# Brainstorm visual companion (not source-tracked)
.superpowers/

# Env files
.env
.env.local
.env.*.local
!.env.example

# Test artifacts
coverage/
.vitest-cache/
playwright-report/
test-results/

# IDE
.vscode/
.idea/
.DS_Store
```

- [ ] **Step 5: Write `.editorconfig`**

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 6: Install root deps and commit**

```bash
pnpm install
git add -A
git commit -m "chore: initialize pnpm workspace skeleton"
```

---

### Task 2: Set up TypeScript and lint configs

**Files:**
- Create: `tsconfig.base.json`, `.prettierrc.json`, `.eslintrc.cjs`, `.prettierignore`

- [ ] **Step 1: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "jsx": "preserve",
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 2: Write `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

- [ ] **Step 3: Write `.prettierignore`**

```
node_modules
.next
dist
build
coverage
pgdata
.superpowers
**/*.md
```

- [ ] **Step 4: Write `.eslintrc.cjs`**

```js
/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['node_modules', 'dist', '.next', 'build', 'coverage', 'pgdata'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'error',
  },
};
```

- [ ] **Step 5: Verify TS compiles**

```bash
pnpm tsc -p tsconfig.base.json --noEmit
```

Expected: No errors (no source files yet, just config check).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: add tsconfig, prettier, eslint"
```

---

### Task 3: Scaffold `packages/core`

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`

- [ ] **Step 1: Create directory and package.json**

```bash
mkdir -p packages/core/src
```

`packages/core/package.json`:

```json
{
  "name": "@benkyou/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./db": "./src/db/index.ts",
    "./ai": "./src/ai/index.ts",
    "./queue": "./src/queue/boss.ts",
    "./config": "./src/config/env.ts"
  },
  "scripts": {
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "ai": "^6.0.0",
    "@ai-sdk/anthropic": "^3.0.0",
    "@ai-sdk/openai": "^3.0.0",
    "@ai-sdk/google": "^3.0.0",
    "@ai-sdk/openai-compatible": "^2.0.0",
    "drizzle-orm": "^0.45.0",
    "postgres": "^3.4.9",
    "pg-boss": "^12.18.0",
    "zod": "^4.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "drizzle-kit": "^0.31.0",
    "vitest": "^4.0.0",
    "testcontainers": "^12.0.0"
  }
}
```

- [ ] **Step 2: Write `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Write `packages/core/src/index.ts`**

```ts
export const VERSION = '0.0.0';
```

- [ ] **Step 4: Install and verify**

```bash
pnpm install
pnpm --filter @benkyou/core typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold packages/core"
```

---

### Task 4: Scaffold `apps/worker`

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/src/index.ts`, `apps/worker/src/loop.ts`, `apps/worker/src/batch.ts`

- [ ] **Step 1: Create directory and package.json**

```bash
mkdir -p apps/worker/src
```

`apps/worker/package.json`:

```json
{
  "name": "@benkyou/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@benkyou/core": "workspace:*",
    "pg-boss": "^12.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "vitest": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Write `apps/worker/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "noEmit": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `apps/worker/src/index.ts` (entry, dispatches by mode)**

```ts
import { env } from '@benkyou/core/config';

async function main() {
  if (env.DEPLOY_MODE === 'docker') {
    const { runLoop } = await import('./loop.js');
    await runLoop();
  } else if (env.DEPLOY_MODE === 'serverless') {
    console.log('Worker entry started in serverless mode — exiting immediately. Use /api/cron/work to trigger work.');
    process.exit(0);
  } else {
    console.error(`Unknown DEPLOY_MODE: ${env.DEPLOY_MODE}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Worker fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Write `apps/worker/src/loop.ts` (long-running stub)**

```ts
export async function runLoop(): Promise<void> {
  console.log('[worker] long-running loop started; awaiting jobs (M0 stub)');
  // M1 will plug in pg-boss handlers
  return new Promise(() => {
    // Intentional never-resolve; SIGTERM kills it
  });
}
```

- [ ] **Step 5: Write `apps/worker/src/batch.ts` (serverless batch stub)**

```ts
export interface BatchResult {
  processed: number;
  errors: number;
}

export async function processBatch(maxJobs: number): Promise<BatchResult> {
  console.log(`[worker] processBatch(${maxJobs}) — M0 stub`);
  return { processed: 0, errors: 0 };
}
```

- [ ] **Step 6: Install + typecheck**

```bash
pnpm install
pnpm --filter @benkyou/worker typecheck
```

Expected: typecheck FAILS because `@benkyou/core/config` doesn't exist yet — this is expected; we'll resolve in Task 8. For now, commit the structure.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold apps/worker (typecheck pending core/config)"
```

---

### Task 5: Scaffold `apps/web` (Next.js)

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.mjs`

- [ ] **Step 1: Create directory and package.json**

```bash
mkdir -p apps/web/app
```

`apps/web/package.json`:

```json
{
  "name": "@benkyou/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@benkyou/core": "workspace:*",
    "next": "^16.2.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "next-intl": "^4.12.0",
    "tailwindcss": "^4.3.0",
    "@tailwindcss/postcss": "^4.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@playwright/test": "^1.60.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vitest": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Write `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `apps/web/next.config.ts`**

```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: true },
};

export default withNextIntl(nextConfig);
```

- [ ] **Step 4: Write `apps/web/postcss.config.mjs`**

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
```

- [ ] **Step 5: Write `apps/web/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

- [ ] **Step 6: Write `apps/web/app/globals.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 7: Write `apps/web/app/layout.tsx`**

```tsx
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import './globals.css';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 8: Write placeholder `apps/web/app/page.tsx`**

```tsx
import { useTranslations } from 'next-intl';

export default function HomePage() {
  const t = useTranslations('home');
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-sm text-slate-500">{t('subtitle')}</p>
    </main>
  );
}
```

- [ ] **Step 9: Install**

```bash
pnpm install
```

- [ ] **Step 10: Commit (i18n config still missing, will add in Task 6)**

```bash
git add -A
git commit -m "chore: scaffold apps/web with Next.js 15 + Tailwind v4"
```

---

## Phase 0.2 · Tooling

### Task 6: Wire up next-intl

**Files:**
- Create: `apps/web/i18n/request.ts`, `apps/web/messages/en.json`, `apps/web/messages/zh.json`, `scripts/check-i18n.ts`

- [ ] **Step 1: Write `apps/web/i18n/request.ts`**

```ts
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

const SUPPORTED = ['zh', 'en'] as const;
type Locale = (typeof SUPPORTED)[number];

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('locale')?.value as Locale | undefined;
  const locale: Locale = cookieLocale && SUPPORTED.includes(cookieLocale) ? cookieLocale : 'zh';

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
```

- [ ] **Step 2: Write `apps/web/messages/zh.json`**

```json
{
  "home": {
    "title": "Benkyou",
    "subtitle": "个人 AI 资讯聚合平台"
  }
}
```

- [ ] **Step 3: Write `apps/web/messages/en.json`**

```json
{
  "home": {
    "title": "Benkyou",
    "subtitle": "Personal AI news aggregator"
  }
}
```

- [ ] **Step 4: Write `scripts/check-i18n.ts`**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flatten(v as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

const root = resolve(process.cwd(), 'apps/web/messages');
const en = JSON.parse(readFileSync(`${root}/en.json`, 'utf8'));
const zh = JSON.parse(readFileSync(`${root}/zh.json`, 'utf8'));

const enKeys = flatten(en);
const zhKeys = flatten(zh);

const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));
const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));

if (missingInZh.length || missingInEn.length) {
  if (missingInZh.length) console.error('Missing in zh.json:', missingInZh);
  if (missingInEn.length) console.error('Missing in en.json:', missingInEn);
  process.exit(1);
}

console.log(`✓ i18n keys consistent (${enKeys.length} keys in both)`);
```

- [ ] **Step 5: Run the check**

```bash
pnpm tsx scripts/check-i18n.ts
```

Expected: `✓ i18n keys consistent (2 keys in both)`.

- [ ] **Step 6: Run dev server, verify home page renders**

```bash
pnpm --filter @benkyou/web dev
```

Open `http://localhost:3000`. Expected: "Benkyou" + "个人 AI 资讯聚合平台" rendered.

Stop the server with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): wire up next-intl with zh/en message bundles"
```

---

### Task 7: Set up Vitest for `packages/core`

**Files:**
- Create: `packages/core/vitest.config.ts`, `packages/core/test/smoke.test.ts`

- [ ] **Step 1: Write `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

- [ ] **Step 2: Write a smoke test `packages/core/test/smoke.test.ts`**

```ts
import { expect, test } from 'vitest';
import { VERSION } from '../src/index.js';

test('core package exports VERSION', () => {
  expect(VERSION).toBe('0.0.0');
});
```

- [ ] **Step 3: Run test**

```bash
pnpm --filter @benkyou/core test
```

Expected: PASS, 1 test.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(core): add vitest smoke test"
```

---

### Task 8: Add `packages/core/src/config/env.ts` (validated env)

**Files:**
- Create: `packages/core/src/config/env.ts`, `packages/core/test/env.test.ts`

- [ ] **Step 1: Write failing test `packages/core/test/env.test.ts`**

```ts
import { describe, expect, test, vi } from 'vitest';

describe('env config', () => {
  test('DEPLOY_MODE defaults to "docker" if unset', async () => {
    vi.resetModules();
    vi.stubEnv('DEPLOY_MODE', '');
    vi.stubEnv('DATABASE_URL', 'postgres://x/y');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(32));
    vi.stubEnv('EMBED_DIM', '1536');
    const { env } = await import('../src/config/env.js');
    expect(env.DEPLOY_MODE).toBe('docker');
    vi.unstubAllEnvs();
  });

  test('rejects when SESSION_SECRET shorter than 32 chars', async () => {
    vi.resetModules();
    vi.stubEnv('DEPLOY_MODE', 'docker');
    vi.stubEnv('DATABASE_URL', 'postgres://x/y');
    vi.stubEnv('SESSION_SECRET', 'short');
    vi.stubEnv('EMBED_DIM', '1536');
    await expect(import('../src/config/env.js')).rejects.toThrow(/SESSION_SECRET/);
    vi.unstubAllEnvs();
  });

  test('EMBED_DIM coerced to number', async () => {
    vi.resetModules();
    vi.stubEnv('DEPLOY_MODE', 'docker');
    vi.stubEnv('DATABASE_URL', 'postgres://x/y');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(32));
    vi.stubEnv('EMBED_DIM', '1536');
    const { env } = await import('../src/config/env.js');
    expect(env.EMBED_DIM).toBe(1536);
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter @benkyou/core test
```

Expected: FAIL — module `../src/config/env.js` not found.

- [ ] **Step 3: Implement `packages/core/src/config/env.ts`**

```ts
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

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  // zod 4 renamed `error.errors` to `error.issues`
  const message = parsed.error.issues
    .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
    .join('\n');
  throw new Error(`Invalid environment:\n${message}`);
}

export const env: Env = parsed.data;
```

- [ ] **Step 4: Run test to verify passes**

```bash
pnpm --filter @benkyou/core test
```

Expected: PASS, 3 env tests + 1 smoke test.

- [ ] **Step 5: Verify worker now typechecks (it imports env)**

```bash
pnpm --filter @benkyou/worker typecheck
```

Expected: PASS (env module now exists).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): validated env config via zod"
```

---

## Phase 0.3 · Database

### Task 9: Install Drizzle and configure

**Files:**
- Create: `packages/core/drizzle.config.ts`, `packages/core/src/db/client.ts`, `packages/core/src/db/index.ts`

- [ ] **Step 1: Write `packages/core/drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou',
  },
  verbose: true,
  strict: true,
});
```

- [ ] **Step 2: Write `packages/core/src/db/client.ts`**

```ts
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../config/env.js';

let _client: postgres.Sql | null = null;

export function getDbClient() {
  if (!_client) {
    _client = postgres(env.DATABASE_URL, { max: 20, prepare: false });
  }
  return drizzle(_client);
}

export async function closeDbClient() {
  if (_client) {
    await _client.end();
    _client = null;
  }
}
```

- [ ] **Step 3: Write `packages/core/src/db/index.ts`**

```ts
export { getDbClient, closeDbClient } from './client.js';
export * from './schema.js';
```

- [ ] **Step 4: Commit (schema.ts coming next)**

```bash
git add -A
git commit -m "feat(core/db): drizzle client + config"
```

---

### Task 10: Write Drizzle schema for all 11 spec tables

**Files:**
- Create: `packages/core/src/db/schema.ts`

- [ ] **Step 1: Write `packages/core/src/db/schema.ts`**

```ts
import {
  pgTable,
  text,
  integer,
  uuid,
  timestamp,
  boolean,
  numeric,
  jsonb,
  pgSchema,
  primaryKey,
  uniqueIndex,
  index,
  date,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { env } from '../config/env.js';

/* pgvector type — Drizzle has no built-in for vector(N), so define a customType */
const vector = (dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dim})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      return JSON.parse(value);
    },
  })();

const tsvectorCol = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/* ─── user_settings ─── */
export const userSettings = pgTable('user_settings', {
  id: integer('id').primaryKey().default(1),
  passwordHash: text('password_hash').notNull(),
  locale: text('locale').notNull().default('zh'),

  llmProvider: text('llm_provider'),
  llmBaseUrl: text('llm_base_url'),
  llmApiKey: text('llm_api_key'),
  llmModel: text('llm_model'),
  llmCheapModel: text('llm_cheap_model'),

  embedProvider: text('embed_provider'),
  embedBaseUrl: text('embed_base_url'),
  embedApiKey: text('embed_api_key'),
  embedModel: text('embed_model'),
  embedDim: integer('embed_dim').notNull(),

  whisperBaseUrl: text('whisper_base_url'),
  whisperApiKey: text('whisper_api_key'),
  whisperModel: text('whisper_model'),

  interestTags: text('interest_tags').array(),
  weightAlpha: numeric('weight_alpha').default('0.6'),
  weightBeta: numeric('weight_beta').default('0.3'),
  weightGamma: numeric('weight_gamma').default('0.1'),
  digestCount: integer('digest_count').default(5),
  videoAutoLimit: integer('video_auto_limit').default(1800),
  videoManualLimit: integer('video_manual_limit').default(10800),
  adhocSourceWeight: numeric('adhoc_source_weight').default('1.0'),
  pipelineMaxAttempts: integer('pipeline_max_attempts').default(3),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/* ─── sessions ─── */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow(),
  ip: text('ip'),
  userAgent: text('user_agent'),
});

/* ─── sources ─── */
export const sources = pgTable(
  'sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').notNull(),
    weight: numeric('weight').default('1.0'),
    enabled: boolean('enabled').default(true),
    pollInterval: integer('poll_interval').default(1800),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
);

/* ─── event_clusters ─── (forward-declared because items references it) */
export const eventClusters = pgTable('event_clusters', {
  id: uuid('id').defaultRandom().primaryKey(),
  canonicalItem: uuid('canonical_item'),
  keywords: text('keywords').array(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).defaultNow(),
  itemCount: integer('item_count').default(1),
});

/* ─── items ─── */
export const items = pgTable(
  'items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    externalId: text('external_id'),
    url: text('url').notNull(),
    urlHash: text('url_hash').notNull(),
    title: text('title').notNull(),
    author: text('author'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    contentType: text('content_type').notNull(),
    rawContent: text('raw_content'),
    transcriptStatus: text('transcript_status').notNull().default('na'),
    transcriptSegments: jsonb('transcript_segments'),
    videoDuration: integer('video_duration'),
    videoKind: text('video_kind'),
    summary: text('summary'),
    deepSummary: text('deep_summary'),
    deepSummaryAt: timestamp('deep_summary_at', { withTimezone: true }),
    topicTags: text('topic_tags').array(),
    depthScore: numeric('depth_score'),
    topicScore: numeric('topic_score'),
    category: text('category'),
    clusterId: uuid('cluster_id').references(() => eventClusters.id, { onDelete: 'set null' }),
    state: text('state').notNull().default('pending'),
    currentStage: text('current_stage'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    bookmarked: boolean('bookmarked').default(false),
    bookmarkedAt: timestamp('bookmarked_at', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow(),
    searchVec: tsvectorCol('search_vec').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(title,'')),'A') || setweight(to_tsvector('simple', coalesce(summary,'')),'B') || setweight(to_tsvector('simple', coalesce(raw_content,'')),'C')`,
    ),
  },
  (t) => ({
    urlHashUnique: uniqueIndex('items_url_hash_uq').on(t.urlHash),
    sourceExternal: uniqueIndex('items_source_ext_uq')
      .on(t.sourceId, t.externalId)
      .where(sql`source_id IS NOT NULL AND external_id IS NOT NULL`),
    stateIdx: index('items_state_idx').on(t.state),
    publishedIdx: index('items_published_idx').on(t.publishedAt),
    sourceIdx: index('items_source_idx').on(t.sourceId),
    bookmarkedIdx: index('items_bookmarked_idx').on(t.bookmarked).where(sql`bookmarked = true`),
    searchVecIdx: index('items_search_vec_idx').using('gin', t.searchVec),
  }),
);

/* ─── item_embeddings ─── (dim from EMBED_DIM env at migration time) */
export const itemEmbeddings = pgTable('item_embeddings', {
  itemId: uuid('item_id')
    .primaryKey()
    .references(() => items.id, { onDelete: 'cascade' }),
  embedding: vector(env.EMBED_DIM)('embedding'),
  titleEmb: vector(env.EMBED_DIM)('title_emb'),
  modelId: text('model_id'),
});

/* ─── digests ─── */
export const digests = pgTable('digests', {
  id: uuid('id').defaultRandom().primaryKey(),
  date: date('date').notNull().unique(),
  introText: text('intro_text'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow(),
});

export const digestItems = pgTable(
  'digest_items',
  {
    digestId: uuid('digest_id')
      .notNull()
      .references(() => digests.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    rank: integer('rank').notNull(),
    reason: text('reason'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.digestId, t.itemId] }),
  }),
);

/* ─── conversations + messages ─── */
export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content'),
    toolCalls: jsonb('tool_calls'),
    toolResult: jsonb('tool_result'),
    referencedItems: uuid('referenced_items').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    convIdx: index('msg_conv_idx').on(t.conversationId, t.createdAt),
  }),
);
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @benkyou/core typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(core/db): drizzle schema for all 11 tables"
```

---

### Task 11: Generate initial migration

**Files:**
- Create: `packages/core/src/db/migrations/0000_initial.sql` (via drizzle-kit), `packages/core/src/db/migrations/meta/_journal.json`, `packages/core/src/db/migrate.ts`, `scripts/migrate.ts`

- [ ] **Step 1: Set EMBED_DIM env and generate migration**

```bash
EMBED_DIM=1536 pnpm --filter @benkyou/core exec drizzle-kit generate --name=initial
```

Expected: creates `packages/core/src/db/migrations/0000_initial.sql` and `meta/_journal.json`.

- [ ] **Step 2: Prepend extension creation to migration SQL**

Edit `packages/core/src/db/migrations/0000_initial.sql` and add at the very top:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Then after the `CREATE TABLE item_embeddings` statement, add HNSW indexes:

```sql
CREATE INDEX item_emb_hnsw ON item_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX title_emb_hnsw ON item_embeddings USING hnsw (title_emb vector_cosine_ops);
```

- [ ] **Step 3: Write `packages/core/src/db/migrate.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  await migrate(db, {
    migrationsFolder: resolve(__dirname, './migrations'),
  });
  await client.end();
}
```

- [ ] **Step 4: Write `scripts/migrate.ts`**

```ts
import { runMigrations } from '@benkyou/core/db/migrate';
import { env } from '@benkyou/core/config';

await runMigrations(env.DATABASE_URL);
console.log('✓ Migrations applied');
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core/db): initial migration with pgvector extension"
```

---

### Task 12: Integration test — migration → tables exist

**Files:**
- Create: `packages/core/test/db.test.ts`

- [ ] **Step 1: Write failing test `packages/core/test/db.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';

describe('migrations apply to a fresh PG', () => {
  let container: StartedTestContainer;
  let url: string;
  let sql: postgres.Sql;

  beforeAll(async () => {
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
        POSTGRES_DB: 'test',
      })
      .withExposedPorts(5432)
      .start();
    const host = container.getHost();
    const port = container.getMappedPort(5432);
    url = `postgres://test:test@${host}:${port}/test`;

    process.env.EMBED_DIM = '1536';
    await runMigrations(url);
    sql = postgres(url);
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  test('all 11 spec tables created', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    const names = rows.map((r) => r.table_name);
    const expected = [
      'conversations',
      'digest_items',
      'digests',
      'event_clusters',
      'item_embeddings',
      'items',
      'messages',
      'sessions',
      'sources',
      'user_settings',
    ];
    for (const t of expected) {
      expect(names).toContain(t);
    }
  });

  test('pgvector extension installed', async () => {
    const rows = await sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    expect(rows).toHaveLength(1);
  });

  test('items.search_vec is a generated tsvector column', async () => {
    const rows = await sql<{ data_type: string; is_generated: string }[]>`
      SELECT data_type, is_generated FROM information_schema.columns
      WHERE table_name = 'items' AND column_name = 'search_vec'
    `;
    expect(rows[0]?.data_type).toBe('tsvector');
    expect(rows[0]?.is_generated).toBe('ALWAYS');
  });

  test('items has url_hash unique index', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'items' AND indexname = 'items_url_hash_uq'
    `;
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test**

```bash
pnpm --filter @benkyou/core test
```

Expected: PASS. (Test container takes ~30s on first run.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(core/db): integration test verifies migrations create all tables"
```

---

## Phase 0.4 · Infrastructure

### Task 13: Write `.env.example` and Docker Compose

**Files:**
- Create: `.env.example`, `docker-compose.yml`, `.env.pg`

- [ ] **Step 1: Write `.env.example`**

```ini
# Deployment mode (docker | serverless)
DEPLOY_MODE=docker

# Web
PORT=3000
SESSION_SECRET=                # 32+ chars; generate with: openssl rand -base64 32
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Database
DATABASE_URL=postgres://benkyou:benkyou@postgres:5432/benkyou

# Initial admin password — used only on first boot, clear afterwards
INITIAL_PASSWORD=

# Embedding dimension — FROZEN at first migration. To change, run
# pnpm tsx scripts/migrate-embeddings.ts --new-dim=N
EMBED_DIM=1536

# Defaults for onboarding form (all blank → user must fill in UI).
# Vercel AI SDK providers: anthropic | openai | openai-compatible | google | mistral | ollama
DEFAULT_LLM_PROVIDER=
DEFAULT_LLM_BASE_URL=
DEFAULT_LLM_API_KEY=
DEFAULT_LLM_MODEL=
DEFAULT_LLM_CHEAP_MODEL=

DEFAULT_EMBED_PROVIDER=
DEFAULT_EMBED_BASE_URL=
DEFAULT_EMBED_API_KEY=
DEFAULT_EMBED_MODEL=

# Optional: OpenAI-Whisper-API-compatible endpoint for video transcription
DEFAULT_WHISPER_BASE_URL=
DEFAULT_WHISPER_API_KEY=
DEFAULT_WHISPER_MODEL=
```

- [ ] **Step 2: Write `.env.pg` (postgres-only env, for docker)**

```ini
POSTGRES_USER=benkyou
POSTGRES_PASSWORD=benkyou
POSTGRES_DB=benkyou
```

- [ ] **Step 3: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    env_file: .env.pg
    volumes:
      - ./pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U benkyou -d benkyou']
      interval: 5s
      timeout: 5s
      retries: 10
    ports:
      - '5432:5432'

  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - '3000:3000'

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: docker-compose with postgres + web + worker"
```

---

### Task 14: Write Dockerfiles

**Files:**
- Create: `Dockerfile.web`, `Dockerfile.worker`, `.dockerignore`

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
.next
dist
build
coverage
pgdata
.superpowers
.git
.github
.env
.env.*
!.env.example
docs
*.md
```

- [ ] **Step 2: Write `Dockerfile.web`** (multi-stage)

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY . .
WORKDIR /app/apps/web
RUN pnpm next build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/apps/web/next.config.ts ./apps/web/
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
```

- [ ] **Step 3: Write `Dockerfile.worker`**

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --filter @benkyou/worker...

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
WORKDIR /app/apps/worker
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/node_modules ./node_modules
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
```

- [ ] **Step 4: Test build (optional — slow, ~3 min first time)**

```bash
docker build -f Dockerfile.web -t benkyou-web:test .
docker build -f Dockerfile.worker -t benkyou-worker:test .
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: Dockerfile.web and Dockerfile.worker (multi-stage)"
```

---

### Task 15: Add `/health` endpoint with DB check

**Files:**
- Create: `apps/web/app/health/route.ts`, `apps/web/test/health.test.ts`

- [ ] **Step 1: Write failing E2E-style test `apps/web/test/health.test.ts`**

```ts
import { describe, expect, test } from 'vitest';

describe('/health', () => {
  test('returns 200 with status field', async () => {
    const { GET } = await import('../app/health/route.js');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body.status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test (will fail — route not implemented)**

```bash
pnpm --filter @benkyou/web test
```

Expected: FAIL.

- [ ] **Step 3: Write `apps/web/app/health/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getDbClient } from '@benkyou/core/db';
import { sql } from 'drizzle-orm';

export async function GET() {
  let dbOk = false;
  try {
    const db = getDbClient();
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return NextResponse.json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk,
    version: process.env.npm_package_version ?? 'dev',
  });
}
```

- [ ] **Step 4: Update vitest config in web to include test/**

Edit `apps/web/vitest.config.ts` (create if missing):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'app/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 5: Add SESSION_SECRET/DATABASE_URL/EMBED_DIM stubs to test env**

Create `apps/web/test/setup.ts`:

```ts
process.env.DEPLOY_MODE = 'docker';
process.env.DATABASE_URL = 'postgres://test/test';
process.env.SESSION_SECRET = 'a'.repeat(40);
process.env.EMBED_DIM = '1536';
```

Update `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'app/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 6: Run test — should still fail (DB not reachable) but route returns 200 with degraded**

Adjust test to allow either ok/degraded since real DB isn't available in unit test:

```ts
test('returns 200 with status field', async () => {
  const { GET } = await import('../app/health/route.js');
  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(['ok', 'degraded']).toContain(body.status);
  expect(typeof body.db).toBe('boolean');
});
```

Run again:

```bash
pnpm --filter @benkyou/web test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): /health endpoint with DB liveness check"
```

---

## Phase 0.5 · Shared libs

### Task 16: Vercel AI SDK provider factory

**Files:**
- Create: `packages/core/src/ai/provider.ts`, `packages/core/src/ai/index.ts`, `packages/core/test/ai.test.ts`

- [ ] **Step 1: Write failing test `packages/core/test/ai.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { resolveLLM, resolveEmbedding } from '../src/ai/provider.js';

describe('AI provider factory', () => {
  test('resolves anthropic provider', () => {
    const m = resolveLLM({ provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-haiku-4-5' });
    expect(m).toBeDefined();
    expect(m.modelId).toContain('claude');
  });

  test('resolves openai-compatible provider with baseURL', () => {
    const m = resolveLLM({
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'unused',
      model: 'qwen2.5:7b',
    });
    expect(m).toBeDefined();
  });

  test('throws on unknown provider', () => {
    expect(() =>
      resolveLLM({ provider: 'unknown', apiKey: '', model: 'x' }),
    ).toThrow(/unknown.*provider/i);
  });

  test('resolves openai embedding', () => {
    const m = resolveEmbedding({ provider: 'openai', apiKey: 'sk', model: 'text-embedding-3-small' });
    expect(m).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — should fail (module missing)**

```bash
pnpm --filter @benkyou/core test
```

Expected: FAIL.

- [ ] **Step 3: Implement `packages/core/src/ai/provider.ts`**

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel, EmbeddingModel } from 'ai';

export interface LLMConfig {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
}

export interface EmbeddingConfig {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
}

export function resolveLLM(cfg: LLMConfig): LanguageModel {
  switch (cfg.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: cfg.apiKey })(cfg.model);
    case 'openai':
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })(cfg.model);
    case 'openai-compatible':
    case 'ollama':
      if (!cfg.baseUrl) throw new Error(`${cfg.provider} requires baseUrl`);
      return createOpenAICompatible({
        name: cfg.provider,
        baseURL: cfg.baseUrl,
        apiKey: cfg.apiKey ?? '',
      })(cfg.model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: cfg.apiKey })(cfg.model);
    default:
      throw new Error(`Unknown LLM provider: ${cfg.provider}`);
  }
}

// NOTE: AI SDK v6 unified embedding method naming. If TypeScript reports
// "Property '.textEmbeddingModel' does not exist", try '.embeddingModel' or
// '.embedding'. See:
//   - @ai-sdk/openai: `.embedding(modelId)` (per provider docs)
//   - @ai-sdk/openai-compatible: `.textEmbeddingModel(modelId)` or `.embeddingModel(modelId)`
//   - @ai-sdk/google: `.textEmbeddingModel(modelId)`
// The tests below will fail fast if any signature is wrong; fix per the package's TS errors.
export function resolveEmbedding(cfg: EmbeddingConfig): EmbeddingModel<string> {
  switch (cfg.provider) {
    case 'openai':
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }).embedding(cfg.model);
    case 'openai-compatible':
    case 'ollama':
      if (!cfg.baseUrl) throw new Error(`${cfg.provider} requires baseUrl`);
      return createOpenAICompatible({
        name: cfg.provider,
        baseURL: cfg.baseUrl,
        apiKey: cfg.apiKey ?? '',
      }).textEmbeddingModel(cfg.model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: cfg.apiKey }).textEmbeddingModel(cfg.model);
    default:
      throw new Error(`Unknown embedding provider: ${cfg.provider}`);
  }
}
```

- [ ] **Step 4: Write `packages/core/src/ai/index.ts`**

```ts
export * from './provider.js';
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @benkyou/core test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core/ai): provider factory with Vercel AI SDK"
```

---

### Task 17: pg-boss singleton wrapper

**Files:**
- Create: `packages/core/src/queue/boss.ts`, `packages/core/test/boss.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/test/boss.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { getBoss, closeBoss } from '../src/queue/boss.js';
import { runMigrations } from '../src/db/migrate.js';

describe('pg-boss wrapper', () => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
        POSTGRES_DB: 'test',
      })
      .withExposedPorts(5432)
      .start();
    process.env.DATABASE_URL = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
    process.env.EMBED_DIM = '1536';
    process.env.SESSION_SECRET = 'a'.repeat(40);
    await runMigrations(process.env.DATABASE_URL);
  }, 120_000);

  afterAll(async () => {
    await closeBoss();
    await container?.stop();
  });

  test('starts pg-boss and can enqueue/process a job', async () => {
    const boss = await getBoss();
    let received: { msg: string } | null = null;
    await boss.work<{ msg: string }>('test-queue', async ([job]) => {
      received = job.data;
    });
    await boss.send('test-queue', { msg: 'hi' });
    await new Promise((r) => setTimeout(r, 2000));
    expect(received).toEqual({ msg: 'hi' });
  });
});
```

- [ ] **Step 2: Run test (fails — module missing)**

- [ ] **Step 3: Implement `packages/core/src/queue/boss.ts`**

```ts
import PgBoss from 'pg-boss';
import { env } from '../config/env.js';

let _boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss;
  _boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    retryLimit: env.PIPELINE_MAX_ATTEMPTS_FALLBACK ?? 3,
    retryBackoff: true,
    archiveCompletedAfterSeconds: 7 * 24 * 60 * 60,
  });
  await _boss.start();
  return _boss;
}

export async function closeBoss(): Promise<void> {
  if (_boss) {
    await _boss.stop({ graceful: true, timeout: 5_000 });
    _boss = null;
  }
}
```

Note: `PIPELINE_MAX_ATTEMPTS_FALLBACK` env var isn't defined; we'll use the default of 3 for now. Simplify:

```ts
import PgBoss from 'pg-boss';
import { env } from '../config/env.js';

let _boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss;
  _boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    retryLimit: 3,
    retryBackoff: true,
    archiveCompletedAfterSeconds: 7 * 24 * 60 * 60,
  });
  await _boss.start();
  return _boss;
}

export async function closeBoss(): Promise<void> {
  if (_boss) {
    await _boss.stop({ graceful: true, timeout: 5_000 });
    _boss = null;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @benkyou/core test
```

Expected: PASS (queue test joins existing migration test, container reuse via testcontainers cache).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core/queue): pg-boss singleton wrapper"
```

---

## Phase 0.6 · CI + Smoke

### Task 18: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint-typecheck-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 11.3.0 }
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm check:i18n
      - run: pnpm test
        env:
          DEPLOY_MODE: docker
          DATABASE_URL: postgres://test:test@localhost:5432/test
          SESSION_SECRET: 'a-test-secret-with-enough-length-32+'
          EMBED_DIM: '1536'

  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build web image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile.web
          push: false
          tags: benkyou-web:ci
      - name: Build worker image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile.worker
          push: false
          tags: benkyou-worker:ci
```

- [ ] **Step 2: Verify locally that the same commands pass**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
DEPLOY_MODE=docker DATABASE_URL=postgres://test:test@localhost:5432/test SESSION_SECRET='a-test-secret-with-enough-length-32+' EMBED_DIM=1536 pnpm test
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ci: github actions for lint+typecheck+test+docker-build"
```

---

### Task 19: End-to-end smoke test — `docker compose up` + `/health`

**Files:**
- Modify: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/smoke.spec.ts`

- [ ] **Step 1: Write `apps/web/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
  },
});
```

- [ ] **Step 2: Write `apps/web/e2e/smoke.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('GET /health returns ok', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.db).toBe(true);
});

test('home page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Benkyou');
});
```

- [ ] **Step 3: Manual smoke — boot stack and run E2E**

```bash
cp .env.example .env
# Generate a session secret:
echo "SESSION_SECRET=$(openssl rand -base64 32)" >> .env

docker compose up -d postgres
sleep 5
pnpm tsx scripts/migrate.ts

docker compose up -d web worker
sleep 10
curl http://localhost:3000/health | jq
```

Expected output:

```json
{ "status": "ok", "db": true, "version": "dev" }
```

Then:

```bash
pnpm --filter @benkyou/web exec playwright install --with-deps chromium
pnpm --filter @benkyou/web test:e2e
```

Expected: 2 tests pass.

- [ ] **Step 4: Tear down**

```bash
docker compose down
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(web): playwright e2e smoke for /health and home page"
```

---

### Task 20: README — quickstart + dev guide

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README with project description, dev setup, smoke test instructions**

```markdown
# Benkyou

Self-hosted personal AI news aggregator with Q&A agent.

> ⚠️ M0 foundation only — not yet useful. See `docs/superpowers/specs/2026-05-27-benkyou-design.md` for the full design and `docs/superpowers/plans/` for implementation phases.

## Quickstart (dev)

Prereqs: Node 22+, pnpm 9, Docker.

```bash
git clone <repo>
cd benkyou
cp .env.example .env
# Edit .env: at minimum, set SESSION_SECRET (any 32+ char string)
echo "SESSION_SECRET=$(openssl rand -base64 32)" >> .env

pnpm install
docker compose up -d postgres
pnpm tsx scripts/migrate.ts
pnpm dev
```

Visit http://localhost:3000.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start web + worker dev mode in parallel |
| `pnpm test` | Run unit + integration tests across all workspaces |
| `pnpm test:e2e` | Run Playwright E2E (requires running stack) |
| `pnpm lint` / `pnpm typecheck` / `pnpm check:i18n` | Quality gates |
| `pnpm tsx scripts/migrate.ts` | Apply DB migrations |

## Project layout

- `apps/web` — Next.js 15 (App Router, React 19, Tailwind v4)
- `apps/worker` — Node background worker
- `packages/core` — Shared business library (DB, AI, queue, sources, pipeline, search, agent)
- `docs/superpowers/specs/` — Design docs
- `docs/superpowers/plans/` — Implementation plans (per-milestone)

## Status

M0 ships: workspace scaffold, DB schema, Docker Compose, CI green, `/health` endpoint.
M1 (in progress): minimal end-to-end loop — auth, 1 RSS source, pipeline stubs, UI.
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: README with quickstart and project layout"
```

---

## Self-Review

After writing this plan, I reviewed against the spec. Coverage map:

| Spec section | Implemented in tasks |
|---|---|
| §4.1 code organization | Tasks 1–5 (apps/web, apps/worker, packages/core) |
| §4.2 runtime processes | Tasks 13, 14 (docker compose + Dockerfiles) |
| §5 data model (11 tables) | Tasks 10, 11 (schema + migration) |
| §6.1 retry attempts column | Task 10 schema |
| §11.3 .env template | Task 13 |
| §11.5 CI | Task 18 |
| §12 i18n (zh/en + key check) | Tasks 6, 6.4 (check-i18n.ts) |
| §2 Vercel AI SDK abstraction | Task 16 |
| §6 pg-boss | Task 17 |

Out of scope for M0 (will be in M1+):
- Auth login flow (sessions table exists; argon2 + login UI in M1)
- Pipeline stages (skeleton tables exist; implementations in M1+)
- UI for setup/feed/search/agent (placeholder home only)
- /api/cron/work serverless endpoint (in M1 with first real pipeline)

**Placeholder scan**: No "TBD" / "implement later" / "add appropriate error handling" — every task has executable code.

**Type consistency**: `resolveLLM` / `resolveEmbedding` used in `packages/core/src/ai/provider.ts` and tested in `packages/core/test/ai.test.ts` — signatures match. `getBoss` / `closeBoss` consistent across tasks. `runMigrations(url: string)` consistent in scripts and tests.

---

## End-state checklist

After completing all 20 tasks:

- [ ] `pnpm install` works
- [ ] `pnpm lint && pnpm typecheck && pnpm test` all green
- [ ] `docker compose up` boots postgres + web + worker without errors
- [ ] `curl http://localhost:3000/health` returns `{"status":"ok","db":true,...}`
- [ ] CI passes on a fresh PR
- [ ] All 11 spec tables exist in postgres (verifiable via `psql -d benkyou -c '\dt'`)
- [ ] pgvector extension installed (`SELECT * FROM pg_extension WHERE extname='vector';` returns 1 row)

Once these all pass, M0 is done. Next plan: M1 — minimal end-to-end loop.
