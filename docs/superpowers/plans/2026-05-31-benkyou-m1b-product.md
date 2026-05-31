# Benkyou M1b · Product Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a human in front of the pipeline. Minimal session auth, a first-run `/setup` flow that writes the `user_settings` row + first RSS source + triggers the first fetch, a home feed of `done` items, an item detail page with lazy deep-summary (streamed), and full hybrid search (`ts_rank` + vector + RRF + quality rerank). End state: fresh deploy → `/setup` → wait ~2 min → the item M1a produced appears on `/`, is searchable, and its detail page streams a deep summary.

**Architecture:** Business logic (auth, search, item queries, deep-summary prompt, setup) lives in `packages/core`; `apps/web` is a thin App-Router layer (Server Components + Server Actions + a couple of Route Handlers) that calls into core. Auth is session-cookie based (no JWT). Routes split into a public set (`/login`, `/setup`) and an authenticated route group `app/(authed)/` whose layout validates the session.

**Tech Stack:** Next.js 16 (App Router, React 19), next-intl 4, Tailwind v4, `@node-rs/argon2` (password hashing), Vercel AI SDK 6 (`streamText`/`embed`), Drizzle 0.45, Vitest 4 + Testcontainers 12 + MSW 2, Playwright 1.60.

> Versions are an audited snapshot. Verify with `pnpm view <pkg> version` before starting if time has passed (per AGENTS.md).

**Reference:** Spec `docs/superpowers/specs/2026-05-27-benkyou-design.md` §7 (search), §8.3 (streaming), §9 (UI/routes), §10 (auth), §11.4 (onboarding). **Depends on M1a** (`docs/superpowers/plans/2026-05-31-benkyou-m1a-pipeline.md`) being merged & green — M1b's `/setup` writes the `user_settings` row and source that the M1a pipeline consumes.

---

## Planner scope decisions (carried from M1)

Confirmed with the maintainer:

1. **Search = full hybrid (§7)** — `ts_rank` + pgvector + RRF + α/β/γ rerank, with `state='done'` + filters pre-applied in **both** candidate queries (Hard Invariant in AGENTS.md).
2. **Auth = minimal-but-correct** — argon2id, `sessions` table, login/logout, route-group gate, sliding+absolute expiry. **Deferred to M5 polish:** CSRF token check, per-IP login rate-limit backoff. Called out explicitly where they'd slot in.
3. This is the second of two linked M1 plans (M1a = pipeline/worker, this = product surface).

---

## Conventions (verified against M0/M1a source — follow exactly)

- **ESM import suffix:** `packages/core/src/**` relative imports use **no** `.js`; test files and `apps/worker/src/**` use `.js`; cross-package imports use the subpath (`@benkyou/core/auth`). `apps/web` uses the `@/*` path alias for its own files (`@/lib/auth`) and `@benkyou/core/*` for core. (See the M1a doc's note on the `env-and-monorepo.md` discrepancy — still applies; don't switch core to `.js`.)
- **No default exports** for modules; **pages/layouts are exempt** (Next.js requires default exports).
- **i18n:** every user-visible string goes through `useTranslations()` (client/server components) or `getTranslations()` (async). Add the key to **both** `apps/web/messages/zh.json` and `en.json` in the same step — `pnpm check:i18n` fails CI otherwise.
- **Strict TS:** no `any` without `// @ts-expect-error` + reason. `noUncheckedIndexedAccess` is on — index access is `T | undefined`.
- **Drizzle numerics are strings** (`numeric` columns); `weight_alpha` etc. come back as strings — `Number()` them before math.
- **Raw SQL** is allowed only for `tsvector` / pgvector / `ts_headline` (Hard Invariant); everything else uses the Drizzle builder.
- **Env loading** (per `docs/dev/env-and-monorepo.md`): web loads root `.env` via `next.config.ts` `process.loadEnvFile`; `assertEnv()` runs in `apps/web/instrumentation.ts`. Host-run scripts/tests override `DATABASE_URL` host to `localhost`.

---

## What you're building on (from M0 + M1a)

- `@benkyou/core/db`: `getDbClient()`, `closeDbClient()`, `sql`, tables (`items`, `sources`, `sessions`, `userSettings`, `itemEmbeddings`, `eventClusters`, …).
- `@benkyou/core/config`: `env`, `assertEnv()`.
- `@benkyou/core/ai`: `resolveLLM`, `resolveEmbedding`, `LLMConfig`, `EmbeddingConfig`.
- `@benkyou/core/settings`: `getUserSettings()`, `buildLLMConfig()`, `buildEmbeddingConfig()`, `UserSettings` type.
- `@benkyou/core/queue`: `getBoss()`, `enqueueIngest()`, `processBatch()`, `registerQueues()` — used to trigger the first fetch from `/setup` and to back `/api/cron/work`.
- `apps/web`: M0 left `app/layout.tsx` (root, next-intl provider), `app/page.tsx` (placeholder home — **this plan moves the home into the authed group**), `app/health/route.ts`, `i18n/request.ts` (cookie locale, `zh` default), `messages/{zh,en}.json`, `instrumentation.ts` (calls `assertEnv()`).

Schema reminders: `sessions(id text pk, expires_at, created_at, last_used_at, ip, user_agent)`; `user_settings` single row id=1, `password_hash NOT NULL`, `embed_dim NOT NULL`; `items.bookmarked`, `items.category`, `items.search_vec` (generated tsvector + GIN), `item_embeddings.embedding vector(EMBED_DIM)` (+ HNSW cosine).

---

## File Structure (created/modified in M1b)

| Path | Responsibility |
|---|---|
| `packages/core/src/auth/password.ts` | argon2id `hashPassword` / `verifyPassword` |
| `packages/core/src/auth/session.ts` | `createSession` / `validateSession` / `destroySession` (sliding+absolute) |
| `packages/core/src/auth/index.ts` | auth barrel |
| `packages/core/src/setup/index.ts` | `isInitialized`, `completeSetup`, `addRssSource`, `triggerSourceFetch`, connectivity tests |
| `packages/core/src/items/queries.ts` | `listFeed`, `getItemForUser`, `countFeed` (all `state='done'`-filtered) |
| `packages/core/src/items/deep-summary.ts` | `buildDeepSummaryPrompt`, `saveDeepSummary` |
| `packages/core/src/items/index.ts` | items barrel |
| `packages/core/src/search/rrf.ts` | pure `rrfMerge` |
| `packages/core/src/search/hybrid.ts` | `hybridSearch` (lexical + vector + RRF + rerank) |
| `packages/core/src/search/index.ts` | search barrel + types |
| `packages/core/package.json` | add `@node-rs/argon2`; add `./auth`,`./items`,`./search`,`./setup` exports |
| `apps/web/lib/auth.ts` | `getValidSession`, `requireAuth`, `requireApiAuth`, `SESSION_COOKIE` |
| `apps/web/middleware.ts` | coarse cookie gate (redirect unauth'd to `/login`) |
| `apps/web/app/page.tsx` | **delete** (home moves into `(authed)`) |
| `apps/web/app/login/page.tsx` + `actions.ts` | login form + action |
| `apps/web/app/setup/page.tsx` + `actions.ts` | first-run setup form + actions |
| `apps/web/app/(authed)/layout.tsx` | session-gated layout (redirect `/login` or `/setup`) |
| `apps/web/app/(authed)/page.tsx` | home feed |
| `apps/web/app/(authed)/items/[id]/page.tsx` | item detail + deep-summary client island |
| `apps/web/app/(authed)/search/page.tsx` | search results |
| `apps/web/app/(authed)/settings/page.tsx` + `actions.ts` | settings (LLM/interests/password; embed_dim read-only) |
| `apps/web/app/api/items/[id]/deep-summary/route.ts` | POST: stream deep summary, persist on finish |
| `apps/web/app/api/cron/work/route.ts` | serverless drain trigger (`processBatch`) |
| `apps/web/components/ItemCard.tsx` | feed/search result card |
| `apps/web/components/DeepSummary.tsx` | client island that streams the deep summary |
| `apps/web/components/LogoutButton.tsx` | client logout |
| `apps/web/messages/{zh,en}.json` | new i18n keys |
| `packages/core/test/auth/*.test.ts`, `search/rrf.test.ts`, `search/hybrid.int.test.ts` | tests |
| `apps/web/e2e/golden-path.spec.ts` | Playwright golden path |

---

## Phase M1b.0 · Dependencies

### Task 1: Add `@node-rs/argon2`

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Add the dependency**

Add to `packages/core/package.json` `dependencies`:

```json
"@node-rs/argon2": "^2.0.2"
```

- [ ] **Step 2: Install**

```bash
pnpm install
```

`@node-rs/argon2` ships prebuilt native binaries (no node-gyp). If pnpm prints a "build scripts blocked" warning for it, add it under `allowBuilds` in `pnpm-workspace.yaml` (where `esbuild`/`sharp` already are) and re-run `pnpm install`. If there is no warning, do nothing.

- [ ] **Step 3: Verify it loads + round-trips**

```bash
pnpm --filter @benkyou/core exec node --input-type=module -e "import {hash,verify} from '@node-rs/argon2'; const h=await hash('pw',{memoryCost:65536,timeCost:3,parallelism:1}); console.log(h.startsWith('\$argon2id\$'), await verify(h,'pw'), await verify(h,'no'))"
```

Expected: `true true false`.

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "chore(core): add @node-rs/argon2 for password hashing"
```

---

## Phase M1b.1 · Auth core

### Task 2: Password hashing (`auth/password.ts`)

**Files:**
- Create: `packages/core/src/auth/password.ts`
- Test: `packages/core/test/auth/password.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';

describe('password hashing', () => {
  test('hash is argon2id and verifies against the original only', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

```bash
pnpm --filter @benkyou/core exec vitest run test/auth/password.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/auth/password.ts`**

```ts
import { hash, verify } from '@node-rs/argon2';

// spec §10.2: argon2id, t=3, m=64MB, p=1
const OPTIONS = { memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  return verify(hashed, plain);
}
```

- [ ] **Step 4: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/auth/password.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/password.ts packages/core/test/auth/password.test.ts
git commit -m "feat(core/auth): argon2id password hashing"
```

---

### Task 3: Sessions (`auth/session.ts`)

**Files:**
- Create: `packages/core/src/auth/session.ts`, `packages/core/src/auth/index.ts`
- Test: `packages/core/test/auth/session.int.test.ts`

- [ ] **Step 1: Write the failing integration test (Testcontainers)**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

type SessionModule = typeof import('../../src/auth/session.js');
type ClientModule = typeof import('../../src/db/client.js');

describe('sessions', () => {
  let container: StartedTestContainer;
  let mod: SessionModule;
  let closeDbClient: ClientModule['closeDbClient'];

  beforeAll(async () => {
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    const url = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
    process.env.DATABASE_URL = url;
    process.env.EMBED_DIM = '1536';
    process.env.SESSION_SECRET = 'a'.repeat(40);
    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations(url);
    mod = await import('../../src/auth/session.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await container?.stop();
  });

  test('create → validate true; destroy → validate false', async () => {
    const { id } = await mod.createSession({ ip: '127.0.0.1', userAgent: 'vitest' });
    expect(id).toHaveLength(43); // 32 bytes base64url
    expect(await mod.validateSession(id)).toBe(true);
    await mod.destroySession(id);
    expect(await mod.validateSession(id)).toBe(false);
  });

  test('unknown id is invalid', async () => {
    expect(await mod.validateSession('nope')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

```bash
pnpm --filter @benkyou/core exec vitest run test/auth/session.int.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/auth/session.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { getDbClient, sessions } from '../db';

const SLIDING_MS = 30 * 24 * 60 * 60 * 1000; // 30d sliding expiry
const ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000; // 90d hard cap (spec §10.2)

export function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(meta: {
  ip?: string;
  userAgent?: string;
}): Promise<{ id: string; expiresAt: Date }> {
  const db = getDbClient();
  const id = generateSessionId();
  const expiresAt = new Date(Date.now() + SLIDING_MS);
  await db.insert(sessions).values({
    id,
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id, expiresAt };
}

// Returns true and slides expiry forward; false (and cleans up) if missing,
// past sliding expiry, or past the absolute 90d cap.
export async function validateSession(id: string): Promise<boolean> {
  const db = getDbClient();
  const now = new Date();
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1);
  const session = rows[0];
  if (!session) return false;

  if (session.createdAt && now.getTime() - session.createdAt.getTime() > ABSOLUTE_MS) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return false;
  }

  await db
    .update(sessions)
    .set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + SLIDING_MS) })
    .where(eq(sessions.id, id));
  return true;
}

export async function destroySession(id: string): Promise<void> {
  const db = getDbClient();
  await db.delete(sessions).where(eq(sessions.id, id));
}
```

- [ ] **Step 4: Write the barrel `packages/core/src/auth/index.ts`**

```ts
export { hashPassword, verifyPassword } from './password';
export { createSession, validateSession, destroySession, generateSessionId } from './session';
```

- [ ] **Step 5: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/auth/session.int.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Add the `./auth` export to `packages/core/package.json`**

Add to the `exports` map:

```json
"./auth": "./src/auth/index.ts",
```

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter @benkyou/core typecheck
git add packages/core/src/auth packages/core/test/auth/session.int.test.ts packages/core/package.json
git commit -m "feat(core/auth): sessions with sliding + absolute expiry"
```

---

## Phase M1b.2 · Web auth wiring

> Server actions/components here are exercised by the Playwright golden path (Phase M1b.8), not unit tests — they're thin glue over the core auth functions already tested in Phase M1b.1.

### Task 4: Edge-safe cookie constant + server auth helpers

**Files:**
- Create: `apps/web/lib/session-cookie.ts`, `apps/web/lib/auth.ts`

- [ ] **Step 1: Create `apps/web/lib/session-cookie.ts`** (no Node imports — safe to import from edge middleware)

```ts
export const SESSION_COOKIE = 'session';
```

- [ ] **Step 2: Create `apps/web/lib/auth.ts`**

```ts
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { validateSession } from '@benkyou/core/auth';
import { SESSION_COOKIE } from './session-cookie';

export async function getValidSession(): Promise<boolean> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return false;
  return validateSession(id);
}

export async function requireAuth(): Promise<void> {
  if (!(await getValidSession())) redirect('/login');
}

// For route handlers: returns a 401 Response to short-circuit, or null if ok.
export async function requireApiAuth(): Promise<Response | null> {
  if (!(await getValidSession())) return new Response('Unauthorized', { status: 401 });
  return null;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/session-cookie.ts apps/web/lib/auth.ts
git commit -m "feat(web/auth): session cookie constant + server-side auth helpers"
```

---

### Task 5: Coarse middleware gate

`validateSession` hits Postgres (Node runtime); middleware runs on the edge runtime and **cannot** reach the DB. So middleware only checks cookie presence; real validation lives in the `(authed)` layout (Task 9).

**Files:**
- Create: `apps/web/middleware.ts`

- [ ] **Step 1: Create `apps/web/middleware.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session-cookie';

const PUBLIC = ['/login', '/setup', '/api/cron', '/health'];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (!req.cookies.get(SESSION_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 2: Typecheck the web app**

```bash
pnpm --filter @benkyou/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat(web): middleware cookie gate (full validation in authed layout)"
```

---

### Task 6: Login page + action; logout action + button

**Files:**
- Create: `apps/web/app/login/actions.ts`, `apps/web/app/login/LoginForm.tsx`, `apps/web/app/login/page.tsx`
- Create: `apps/web/app/(authed)/actions.ts`, `apps/web/components/LogoutButton.tsx`
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`

- [ ] **Step 1: Add i18n keys to BOTH message files**

`apps/web/messages/zh.json` — add top-level keys:

```json
"login": { "title": "登录", "password": "密码", "submit": "登录", "invalid": "密码错误" },
"nav": { "feed": "动态", "search": "搜索", "settings": "设置", "logout": "退出" }
```

`apps/web/messages/en.json`:

```json
"login": { "title": "Sign in", "password": "Password", "submit": "Sign in", "invalid": "Wrong password" },
"nav": { "feed": "Feed", "search": "Search", "settings": "Settings", "logout": "Sign out" }
```

- [ ] **Step 2: Create `apps/web/app/login/actions.ts`**

```ts
'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSession, verifyPassword } from '@benkyou/core/auth';
import { getUserSettings } from '@benkyou/core/settings';
import { SESSION_COOKIE } from '@/lib/session-cookie';

export interface LoginState {
  error?: boolean;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get('password') ?? '');
  const settings = await getUserSettings();
  if (!settings) redirect('/setup');

  if (!(await verifyPassword(settings.passwordHash, password))) {
    return { error: true };
  }

  const h = await headers();
  const { id, expiresAt } = await createSession({
    ip: h.get('x-forwarded-for') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  });
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
  redirect('/');
}
```

- [ ] **Step 3: Create `apps/web/app/login/LoginForm.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { loginAction, type LoginState } from './actions';

export function LoginForm() {
  const t = useTranslations('login');
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input
        type="password"
        name="password"
        required
        autoFocus
        placeholder={t('password')}
        className="rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800"
      />
      {state.error ? <p className="text-sm text-red-600">{t('invalid')}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-900 p-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {t('submit')}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Create `apps/web/app/login/page.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isInitialized } from '@benkyou/core/setup';
import { getValidSession } from '@/lib/auth';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  if (!(await isInitialized())) redirect('/setup');
  if (await getValidSession()) redirect('/');
  const t = await getTranslations('login');
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>
      <LoginForm />
    </main>
  );
}
```

> `isInitialized` is implemented in Phase M1b.3 (Task 7). If you build this task first, temporarily stub it or do Task 7 first — the two tasks are tightly coupled and may be done together.

- [ ] **Step 5: Create `apps/web/app/(authed)/actions.ts`**

```ts
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { destroySession } from '@benkyou/core/auth';
import { SESSION_COOKIE } from '@/lib/session-cookie';

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (id) await destroySession(id);
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
```

- [ ] **Step 6: Create `apps/web/components/LogoutButton.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { logoutAction } from '@/app/(authed)/actions';

export function LogoutButton() {
  const t = useTranslations('nav');
  return (
    <form action={logoutAction}>
      <button type="submit" className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
        {t('logout')}
      </button>
    </form>
  );
}
```

- [ ] **Step 7: Verify i18n + typecheck**

```bash
pnpm check:i18n
pnpm --filter @benkyou/web typecheck
```

Expected: i18n consistent; typecheck passes (assuming Task 7 `isInitialized` exists).

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/login apps/web/app/\(authed\)/actions.ts apps/web/components/LogoutButton.tsx apps/web/messages
git commit -m "feat(web/auth): login page/action + logout"
```

---

### Task 7-pre: Serverless cron drain endpoint

The serverless deploy mode (and a quick manual trigger in docker) needs an HTTP entry to drain the queue. It reuses M1a's `processBatch`.

**Files:**
- Create: `apps/web/app/api/cron/work/route.ts`
- Modify: `.env.example`

- [ ] **Step 1: Create `apps/web/app/api/cron/work/route.ts`**

```ts
import { processBatch } from '@benkyou/core/queue';

// Public trigger for serverless mode (external cron pings this). Optional shared
// secret via CRON_SECRET. In docker mode the long-running worker drains instead,
// but this endpoint is harmless there too.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = url.searchParams.get('secret') ?? req.headers.get('authorization')?.replace(/^Bearer /, '');
    if (provided !== secret) return new Response('Forbidden', { status: 403 });
  }
  const maxRaw = Number(url.searchParams.get('max') ?? '20');
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.min(maxRaw, 100) : 20;
  const result = await processBatch(max);
  return Response.json(result);
}
```

- [ ] **Step 2: Document `CRON_SECRET` in `.env.example`**

Append:

```ini
# Optional: shared secret guarding /api/cron/work in serverless mode
CRON_SECRET=
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @benkyou/web typecheck
git add apps/web/app/api/cron/work/route.ts .env.example
git commit -m "feat(web): /api/cron/work serverless drain endpoint"
```

---

## Phase M1b.3 · First-run setup (`/setup`)

This is the keystone connecting the two plans: completing setup writes the single `user_settings` row + first RSS `sources` row, then enqueues the first ingest — which the M1a worker/cron then drains to `done`.

### Task 7: Core setup helpers (`setup/index.ts`)

**Files:**
- Create: `packages/core/src/setup/index.ts`
- Modify: `packages/core/package.json` (add `./setup` export)
- Test: `packages/core/test/setup/setup.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

type SetupModule = typeof import('../../src/setup/index.js');

describe('setup', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let setup: SetupModule;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    const url = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
    process.env.DATABASE_URL = url;
    process.env.EMBED_DIM = '1536';
    process.env.SESSION_SECRET = 'a'.repeat(40);
    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations(url);
    sql = postgres(url);
    setup = await import('../../src/setup/index.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('isInitialized flips after completeSetup; embed_dim comes from env', async () => {
    expect(await setup.isInitialized()).toBe(false);
    await setup.completeSetup({
      password: 'pw-12345678',
      locale: 'en',
      llm: { provider: 'openai', model: 'gpt-x', cheapModel: 'gpt-x-mini' },
      embedding: { provider: 'openai', model: 'emb-x' },
      interestTags: ['llm', 'agents'],
    });
    expect(await setup.isInitialized()).toBe(true);
    const rows = await sql<{ embed_dim: number; password_hash: string; interest_tags: string[] }[]>`
      SELECT embed_dim, password_hash, interest_tags FROM user_settings WHERE id = 1`;
    expect(rows[0]!.embed_dim).toBe(1536);
    expect(rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]!.interest_tags).toEqual(['llm', 'agents']);
  });

  test('addRssSource inserts an rss source and returns its id', async () => {
    const id = await setup.addRssSource('Test Feed', 'https://feeds.test/rss');
    const rows = await sql<{ type: string; config: { url: string } }[]>`
      SELECT type, config FROM sources WHERE id = ${id}`;
    expect(rows[0]!.type).toBe('rss');
    expect(rows[0]!.config.url).toBe('https://feeds.test/rss');
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

```bash
pnpm --filter @benkyou/core exec vitest run test/setup/setup.int.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/setup/index.ts`**

```ts
import { eq } from 'drizzle-orm';
import { embed, generateText } from 'ai';
import { getDbClient, sources, userSettings } from '../db';
import { env } from '../config/env';
import { hashPassword } from '../auth';
import { enqueueIngest, getBoss, registerQueues } from '../queue';
import { resolveEmbedding, resolveLLM, type EmbeddingConfig, type LLMConfig } from '../ai';

export async function isInitialized(): Promise<boolean> {
  const db = getDbClient();
  const rows = await db
    .select({ id: userSettings.id })
    .from(userSettings)
    .where(eq(userSettings.id, 1))
    .limit(1);
  return rows.length > 0;
}

export interface SetupInput {
  password: string;
  locale: 'zh' | 'en';
  llm: { provider: string; baseUrl?: string; apiKey?: string; model: string; cheapModel?: string };
  embedding: { provider: string; baseUrl?: string; apiKey?: string; model: string };
  interestTags: string[];
}

export async function completeSetup(input: SetupInput): Promise<void> {
  const db = getDbClient();
  const passwordHash = await hashPassword(input.password);
  await db
    .insert(userSettings)
    .values({
      id: 1,
      passwordHash,
      locale: input.locale,
      embedDim: env.EMBED_DIM, // frozen at install time (Hard Invariant)
      llmProvider: input.llm.provider,
      llmBaseUrl: input.llm.baseUrl ?? null,
      llmApiKey: input.llm.apiKey ?? null,
      llmModel: input.llm.model,
      llmCheapModel: input.llm.cheapModel ?? input.llm.model,
      embedProvider: input.embedding.provider,
      embedBaseUrl: input.embedding.baseUrl ?? null,
      embedApiKey: input.embedding.apiKey ?? null,
      embedModel: input.embedding.model,
      interestTags: input.interestTags,
    })
    .onConflictDoNothing({ target: userSettings.id });
}

export async function addRssSource(name: string, url: string): Promise<string> {
  const db = getDbClient();
  const rows = await db
    .insert(sources)
    .values({ type: 'rss', name, config: { url } })
    .returning({ id: sources.id });
  const id = rows[0]?.id;
  if (!id) throw new Error('Failed to create source');
  return id;
}

export async function triggerSourceFetch(sourceId: string): Promise<void> {
  const boss = await getBoss();
  await registerQueues(boss, 3); // idempotent; ensures the ingest queue exists before send
  await enqueueIngest(boss, sourceId);
}

export async function testLLM(cfg: LLMConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await generateText({ model: resolveLLM(cfg), prompt: 'ping' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function testEmbedding(
  cfg: EmbeddingConfig,
): Promise<{ ok: boolean; dim?: number; error?: string }> {
  try {
    const { embedding } = await embed({ model: resolveEmbedding(cfg), value: 'ping' });
    return { ok: true, dim: embedding.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Add the `./setup` export to `packages/core/package.json`**

```json
"./setup": "./src/setup/index.ts",
```

- [ ] **Step 5: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/setup/setup.int.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/setup packages/core/test/setup packages/core/package.json
git commit -m "feat(core/setup): isInitialized, completeSetup, addRssSource, triggerFetch, connectivity tests"
```

---

### Task 8: `/setup` page + action (enforces connectivity + dim match, auto-login)

**Files:**
- Create: `apps/web/app/setup/actions.ts`, `apps/web/app/setup/SetupForm.tsx`, `apps/web/app/setup/page.tsx`
- Modify: `apps/web/messages/{zh,en}.json`

- [ ] **Step 1: Add `setup` i18n keys to BOTH message files**

`zh.json`:

```json
"setup": {
  "title": "初始化 Benkyou",
  "needInitialPassword": "请先在 .env 设置 INITIAL_PASSWORD，再刷新本页。",
  "locale": "界面语言",
  "llmSection": "对话模型 (LLM)",
  "embedSection": "向量模型 (Embedding)",
  "provider": "Provider",
  "baseUrl": "Base URL（openai-compatible / ollama 必填）",
  "apiKey": "API Key",
  "model": "模型",
  "cheapModel": "便宜模型（评分/摘要用，可留空）",
  "interests": "兴趣标签（英文逗号分隔）",
  "sourceSection": "第一个 RSS 源",
  "sourceName": "名称",
  "sourceUrl": "RSS 地址",
  "submit": "完成初始化并抓取",
  "dimMismatch": "Embedding 维度 {got} 与 EMBED_DIM={want} 不一致，请改用匹配的模型或更换 EMBED_DIM 重新初始化。",
  "llmFailed": "LLM 连接失败：{error}",
  "embedFailed": "Embedding 连接失败：{error}"
}
```

`en.json`:

```json
"setup": {
  "title": "Initialize Benkyou",
  "needInitialPassword": "Set INITIAL_PASSWORD in .env first, then refresh this page.",
  "locale": "Language",
  "llmSection": "Chat model (LLM)",
  "embedSection": "Embedding model",
  "provider": "Provider",
  "baseUrl": "Base URL (required for openai-compatible / ollama)",
  "apiKey": "API Key",
  "model": "Model",
  "cheapModel": "Cheap model (for scoring/summaries, optional)",
  "interests": "Interest tags (comma-separated)",
  "sourceSection": "First RSS source",
  "sourceName": "Name",
  "sourceUrl": "RSS URL",
  "submit": "Finish & fetch",
  "dimMismatch": "Embedding dim {got} != EMBED_DIM={want}. Use a matching model or re-init with a different EMBED_DIM.",
  "llmFailed": "LLM connection failed: {error}",
  "embedFailed": "Embedding connection failed: {error}"
}
```

- [ ] **Step 2: Create `apps/web/app/setup/actions.ts`**

```ts
'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { env } from '@benkyou/core/config';
import { createSession } from '@benkyou/core/auth';
import {
  addRssSource,
  completeSetup,
  testEmbedding,
  testLLM,
  triggerSourceFetch,
} from '@benkyou/core/setup';
import { SESSION_COOKIE } from '@/lib/session-cookie';

export interface SetupState {
  error?: string;
  values?: { got: number; want: number };
}

const Schema = z.object({
  locale: z.enum(['zh', 'en']),
  llmProvider: z.string().min(1),
  llmBaseUrl: z.string().optional(),
  llmApiKey: z.string().optional(),
  llmModel: z.string().min(1),
  llmCheapModel: z.string().optional(),
  embedProvider: z.string().min(1),
  embedBaseUrl: z.string().optional(),
  embedApiKey: z.string().optional(),
  embedModel: z.string().min(1),
  interestTags: z.string().optional(),
  sourceName: z.string().min(1),
  sourceUrl: z.string().url(),
});

function str(fd: FormData, k: string): string | undefined {
  const v = fd.get(k);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function setupAction(_prev: SetupState, fd: FormData): Promise<SetupState> {
  if (!env.INITIAL_PASSWORD) return { error: 'needInitialPassword' };

  const parsed = Schema.safeParse({
    locale: fd.get('locale'),
    llmProvider: fd.get('llmProvider'),
    llmBaseUrl: str(fd, 'llmBaseUrl'),
    llmApiKey: str(fd, 'llmApiKey'),
    llmModel: fd.get('llmModel'),
    llmCheapModel: str(fd, 'llmCheapModel'),
    embedProvider: fd.get('embedProvider'),
    embedBaseUrl: str(fd, 'embedBaseUrl'),
    embedApiKey: str(fd, 'embedApiKey'),
    embedModel: fd.get('embedModel'),
    interestTags: str(fd, 'interestTags'),
    sourceName: fd.get('sourceName'),
    sourceUrl: fd.get('sourceUrl'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'invalid' };
  const v = parsed.data;

  const llmCfg = { provider: v.llmProvider, baseUrl: v.llmBaseUrl, apiKey: v.llmApiKey, model: v.llmModel };
  const embedCfg = { provider: v.embedProvider, baseUrl: v.embedBaseUrl, apiKey: v.embedApiKey, model: v.embedModel };

  // Onboarding forces connectivity tests (spec §14.1: misconfig is the #1 risk).
  const llmTest = await testLLM(llmCfg);
  if (!llmTest.ok) return { error: 'llmFailed' };
  const embTest = await testEmbedding(embedCfg);
  if (!embTest.ok) return { error: 'embedFailed' };
  if (embTest.dim !== env.EMBED_DIM) {
    return { error: 'dimMismatch', values: { got: embTest.dim ?? 0, want: env.EMBED_DIM } };
  }

  await completeSetup({
    password: env.INITIAL_PASSWORD,
    locale: v.locale,
    llm: { ...llmCfg, cheapModel: v.llmCheapModel },
    embedding: embedCfg,
    interestTags: (v.interestTags ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  });
  const sourceId = await addRssSource(v.sourceName, v.sourceUrl);
  await triggerSourceFetch(sourceId);

  const h = await headers();
  const { id, expiresAt } = await createSession({
    ip: h.get('x-forwarded-for') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  });
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
  redirect('/');
}
```

- [ ] **Step 3: Create `apps/web/app/setup/SetupForm.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { setupAction, type SetupState } from './actions';

const field = 'rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800';

export function SetupForm() {
  const t = useTranslations('setup');
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});

  const errorText =
    state.error === 'dimMismatch'
      ? t('dimMismatch', { got: state.values?.got ?? 0, want: state.values?.want ?? 0 })
      : state.error
        ? t(state.error as 'llmFailed')
        : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm">{t('locale')}</span>
        <select name="locale" defaultValue="zh" className={field}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold">{t('llmSection')}</legend>
        <input name="llmProvider" required placeholder={t('provider')} defaultValue="openai" className={field} />
        <input name="llmBaseUrl" placeholder={t('baseUrl')} className={field} />
        <input name="llmApiKey" type="password" placeholder={t('apiKey')} className={field} />
        <input name="llmModel" required placeholder={t('model')} className={field} />
        <input name="llmCheapModel" placeholder={t('cheapModel')} className={field} />
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold">{t('embedSection')}</legend>
        <input name="embedProvider" required placeholder={t('provider')} defaultValue="openai" className={field} />
        <input name="embedBaseUrl" placeholder={t('baseUrl')} className={field} />
        <input name="embedApiKey" type="password" placeholder={t('apiKey')} className={field} />
        <input name="embedModel" required placeholder={t('model')} className={field} />
      </fieldset>

      <input name="interestTags" placeholder={t('interests')} className={field} />

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold">{t('sourceSection')}</legend>
        <input name="sourceName" required placeholder={t('sourceName')} className={field} />
        <input name="sourceUrl" type="url" required placeholder={t('sourceUrl')} className={field} />
      </fieldset>

      {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-900 p-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {t('submit')}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Create `apps/web/app/setup/page.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isInitialized } from '@benkyou/core/setup';
import { env } from '@benkyou/core/config';
import { SetupForm } from './SetupForm';

export default async function SetupPage() {
  if (await isInitialized()) redirect('/login');
  const t = await getTranslations('setup');
  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>
      {env.INITIAL_PASSWORD ? <SetupForm /> : <p className="text-red-600">{t('needInitialPassword')}</p>}
    </main>
  );
}
```

- [ ] **Step 5: Verify + commit**

```bash
pnpm check:i18n
pnpm --filter @benkyou/web typecheck
git add apps/web/app/setup apps/web/messages
git commit -m "feat(web/setup): /setup flow (connectivity+dim checks, first source, auto-login)"
```

---

## Phase M1b.4 · Item queries + authed layout + home feed

### Task 9: Core item queries (`items/queries.ts` + `items/index.ts`)

**Files:**
- Create: `packages/core/src/items/queries.ts`, `packages/core/src/items/index.ts`
- Modify: `packages/core/package.json` (add `./items` export)
- Test: `packages/core/test/items/queries.int.test.ts`

> Every user-facing query filters `state='done'` (Hard Invariant). `getItemForUser` returns `null` for non-`done` items so detail pages can't leak in-flight content.

- [ ] **Step 1: Write the failing integration test**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

type ItemsModule = typeof import('../../src/items/index.js');

describe('item queries', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let items: ItemsModule;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    const url = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
    process.env.DATABASE_URL = url;
    process.env.EMBED_DIM = '1536';
    process.env.SESSION_SECRET = 'a'.repeat(40);
    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations(url);
    sql = postgres(url);
    await sql`INSERT INTO sources (id, type, name, config) VALUES
      ('11111111-1111-1111-1111-111111111111','rss','Feed','{"url":"x"}')`;
    // one done, one still pending
    await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state, summary, published_at) VALUES
      ('11111111-1111-1111-1111-111111111111','https://a','ha','Done One','article','done','sum a', now()),
      ('11111111-1111-1111-1111-111111111111','https://b','hb','Pending One','article','pending', null, now())`;
    items = await import('../../src/items/index.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('listFeed returns only done items, with source name', async () => {
    const feed = await items.listFeed({ limit: 30, offset: 0 });
    expect(feed).toHaveLength(1);
    expect(feed[0]!.title).toBe('Done One');
    expect(feed[0]!.sourceName).toBe('Feed');
  });

  test('getItemForUser returns done item, null for pending', async () => {
    const feed = await items.listFeed({ limit: 30, offset: 0 });
    const got = await items.getItemForUser(feed[0]!.id);
    expect(got?.title).toBe('Done One');

    const pending = await sql<{ id: string }[]>`SELECT id FROM items WHERE state='pending'`;
    expect(await items.getItemForUser(pending[0]!.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

```bash
pnpm --filter @benkyou/core exec vitest run test/items/queries.int.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/items/queries.ts`**

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDbClient, items, sources } from '../db';

export interface FeedItem {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  category: string | null;
  contentType: string;
  publishedAt: Date | null;
  sourceName: string | null;
  bookmarked: boolean;
}

export interface ItemDetail extends FeedItem {
  rawContent: string | null;
  deepSummary: string | null;
  author: string | null;
  topicTags: string[] | null;
}

const FEED_COLUMNS = {
  id: items.id,
  title: items.title,
  summary: items.summary,
  url: items.url,
  category: items.category,
  contentType: items.contentType,
  publishedAt: items.publishedAt,
  bookmarked: items.bookmarked,
  sourceName: sources.name,
};

export async function listFeed(opts: { limit: number; offset: number }): Promise<FeedItem[]> {
  const db = getDbClient();
  const rows = await db
    .select(FEED_COLUMNS)
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(items.state, 'done'))
    .orderBy(desc(sql`coalesce(${items.publishedAt}, ${items.ingestedAt})`))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map((r) => ({ ...r, bookmarked: r.bookmarked ?? false }));
}

export async function getItemForUser(id: string): Promise<ItemDetail | null> {
  const db = getDbClient();
  const rows = await db
    .select({
      ...FEED_COLUMNS,
      rawContent: items.rawContent,
      deepSummary: items.deepSummary,
      author: items.author,
      topicTags: items.topicTags,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(and(eq(items.id, id), eq(items.state, 'done')))
    .limit(1);
  const r = rows[0];
  return r ? { ...r, bookmarked: r.bookmarked ?? false } : null;
}
```

- [ ] **Step 4: Create `packages/core/src/items/index.ts`**

```ts
export { listFeed, getItemForUser } from './queries';
export type { FeedItem, ItemDetail } from './queries';
export { buildDeepSummaryPrompt, saveDeepSummary } from './deep-summary';
```

> `deep-summary` is created in Phase M1b.6 (Task 13). If typecheck complains now, do Task 13's Step 1 first or temporarily drop that export line until Task 13.

- [ ] **Step 5: Add the `./items` export to `packages/core/package.json`**

```json
"./items": "./src/items/index.ts",
```

- [ ] **Step 6: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/items/queries.int.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/items packages/core/test/items packages/core/package.json
git commit -m "feat(core/items): done-filtered feed + detail queries"
```

---

### Task 10: Authed layout, `ItemCard`, home feed; delete the M0 placeholder home

**Files:**
- Delete: `apps/web/app/page.tsx`
- Create: `apps/web/app/(authed)/layout.tsx`, `apps/web/app/(authed)/page.tsx`, `apps/web/components/ItemCard.tsx`
- Modify: `apps/web/messages/{zh,en}.json`

- [ ] **Step 1: Delete the placeholder home (it would collide with `(authed)/page.tsx` at `/`)**

```bash
git rm apps/web/app/page.tsx
```

- [ ] **Step 2: Add `feed` i18n keys to BOTH message files**

`zh.json`: `"feed": { "title": "动态", "empty": "还没有内容。添加源后约 2 分钟内会出现。", "prev": "上一页", "next": "下一页" }`

`en.json`: `"feed": { "title": "Feed", "empty": "Nothing yet. Items appear ~2 min after adding a source.", "prev": "Prev", "next": "Next" }`

- [ ] **Step 3: Create `apps/web/app/(authed)/layout.tsx`**

```tsx
import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isInitialized } from '@benkyou/core/setup';
import { getValidSession } from '@/lib/auth';
import { LogoutButton } from '@/components/LogoutButton';

export default async function AuthedLayout({ children }: { children: ReactNode }) {
  if (!(await isInitialized())) redirect('/setup');
  if (!(await getValidSession())) redirect('/login');
  const t = await getTranslations('nav');
  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-6 flex items-center gap-4 border-b border-slate-200 pb-3 dark:border-slate-700">
        <Link href="/" className="font-bold">Benkyou</Link>
        <nav className="flex gap-3 text-sm">
          <Link href="/">{t('feed')}</Link>
          <Link href="/search">{t('search')}</Link>
          <Link href="/settings">{t('settings')}</Link>
        </nav>
        <div className="ml-auto">
          <LogoutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/web/components/ItemCard.tsx`**

```tsx
import Link from 'next/link';
import type { FeedItem } from '@benkyou/core/items';

const TYPE_ICON: Record<string, string> = {
  article: '📄',
  video: '🎥',
  discussion: '💬',
  paper: '📑',
};

export function ItemCard({ item }: { item: FeedItem }) {
  return (
    <article className="rounded border border-slate-200 p-3 dark:border-slate-700">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>{TYPE_ICON[item.contentType] ?? '📄'}</span>
        {item.sourceName ? <span>{item.sourceName}</span> : null}
        {item.category ? <span>· {item.category === 'news' ? '📰' : '📚'}</span> : null}
        {item.publishedAt ? <span>· {new Date(item.publishedAt).toLocaleDateString()}</span> : null}
      </div>
      <h2 className="font-semibold">
        <Link href={`/items/${item.id}`}>{item.title}</Link>
      </h2>
      {item.summary ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{item.summary}</p>
      ) : null}
    </article>
  );
}
```

- [ ] **Step 5: Create `apps/web/app/(authed)/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server';
import { listFeed } from '@benkyou/core/items';
import { ItemCard } from '@/components/ItemCard';

const PAGE_SIZE = 30;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const t = await getTranslations('feed');
  const { page } = await searchParams;
  const pageNum = Math.max(1, Number(page ?? '1') || 1);
  const feed = await listFeed({ limit: PAGE_SIZE, offset: (pageNum - 1) * PAGE_SIZE });

  return (
    <main>
      <h1 className="mb-4 text-xl font-bold">{t('title')}</h1>
      {feed.length === 0 ? (
        <p className="text-slate-500">{t('empty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {feed.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
      <div className="mt-6 flex justify-between text-sm text-slate-500">
        {pageNum > 1 ? <a href={`/?page=${pageNum - 1}`}>← {t('prev')}</a> : <span />}
        {feed.length === PAGE_SIZE ? <a href={`/?page=${pageNum + 1}`}>{t('next')} →</a> : <span />}
      </div>
    </main>
  );
}
```

> Offset pagination is intentional for M1; spec §9.3's infinite scroll is M5 polish.

- [ ] **Step 6: Verify + commit**

```bash
pnpm check:i18n
pnpm --filter @benkyou/web typecheck
git add -A
git commit -m "feat(web): authed layout + home feed + item card; drop placeholder home"
```

---

## Phase M1b.5 · Settings

### Task 11: Core settings mutations

**Files:**
- Modify: `packages/core/src/settings/index.ts`

- [ ] **Step 1: Append mutations to `packages/core/src/settings/index.ts`**

Add these exports below the existing `buildEmbeddingConfig` (keep `setPasswordHash` taking a pre-computed hash so `settings` stays decoupled from `auth`):

```ts
import { eq } from 'drizzle-orm'; // already imported at top — do not duplicate

export interface SettingsPatch {
  locale?: 'zh' | 'en';
  llmProvider?: string;
  llmBaseUrl?: string | null;
  llmApiKey?: string | null;
  llmModel?: string;
  llmCheapModel?: string | null;
  embedProvider?: string;
  embedBaseUrl?: string | null;
  embedApiKey?: string | null;
  embedModel?: string;
  interestTags?: string[];
}

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  const db = getDbClient();
  await db
    .update(userSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(userSettings.id, 1));
}

// Hashing stays in @benkyou/core/auth; the web action hashes then calls this.
export async function setPasswordHash(passwordHash: string): Promise<void> {
  const db = getDbClient();
  await db
    .update(userSettings)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(userSettings.id, 1));
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @benkyou/core typecheck
git add packages/core/src/settings/index.ts
git commit -m "feat(core/settings): updateSettings + setPasswordHash mutations"
```

---

### Task 12: `/settings` page + actions

**Files:**
- Create: `apps/web/app/(authed)/settings/actions.ts`, `apps/web/app/(authed)/settings/SettingsForm.tsx`, `apps/web/app/(authed)/settings/PasswordForm.tsx`, `apps/web/app/(authed)/settings/page.tsx`
- Modify: `apps/web/messages/{zh,en}.json`

- [ ] **Step 1: Add `settings` i18n keys to BOTH message files**

`zh.json`:

```json
"settings": {
  "title": "设置",
  "providerSection": "模型配置",
  "saved": "已保存",
  "embedDimNote": "Embedding 维度在初始化时固定为 {dim}，如需更改请运行 scripts/migrate-embeddings.ts。",
  "passwordSection": "修改密码",
  "newPassword": "新密码（至少 8 位）",
  "changePassword": "更新密码",
  "passwordTooShort": "密码至少 8 位",
  "passwordChanged": "密码已更新",
  "save": "保存",
  "llmFailed": "LLM 连接失败：{error}",
  "embedFailed": "Embedding 连接失败：{error}",
  "dimMismatch": "Embedding 维度 {got} 与固定值 {want} 不一致。"
}
```

`en.json`:

```json
"settings": {
  "title": "Settings",
  "providerSection": "Model configuration",
  "saved": "Saved",
  "embedDimNote": "Embedding dim is frozen at {dim} since install. To change it, run scripts/migrate-embeddings.ts.",
  "passwordSection": "Change password",
  "newPassword": "New password (min 8 chars)",
  "changePassword": "Update password",
  "passwordTooShort": "Password must be at least 8 characters",
  "passwordChanged": "Password updated",
  "save": "Save",
  "llmFailed": "LLM connection failed: {error}",
  "embedFailed": "Embedding connection failed: {error}",
  "dimMismatch": "Embedding dim {got} != frozen {want}."
}
```

- [ ] **Step 2: Create `apps/web/app/(authed)/settings/actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { env } from '@benkyou/core/config';
import { hashPassword } from '@benkyou/core/auth';
import { setPasswordHash, updateSettings } from '@benkyou/core/settings';
import { testEmbedding, testLLM } from '@benkyou/core/setup';

export interface SettingsState {
  ok?: boolean;
  error?: string;
  values?: { got: number; want: number };
}

const Schema = z.object({
  locale: z.enum(['zh', 'en']),
  llmProvider: z.string().min(1),
  llmBaseUrl: z.string().optional(),
  llmApiKey: z.string().optional(),
  llmModel: z.string().min(1),
  llmCheapModel: z.string().optional(),
  embedProvider: z.string().min(1),
  embedBaseUrl: z.string().optional(),
  embedApiKey: z.string().optional(),
  embedModel: z.string().min(1),
  interestTags: z.string().optional(),
});

function str(fd: FormData, k: string): string | undefined {
  const v = fd.get(k);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function updateSettingsAction(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  const parsed = Schema.safeParse({
    locale: fd.get('locale'),
    llmProvider: fd.get('llmProvider'),
    llmBaseUrl: str(fd, 'llmBaseUrl'),
    llmApiKey: str(fd, 'llmApiKey'),
    llmModel: fd.get('llmModel'),
    llmCheapModel: str(fd, 'llmCheapModel'),
    embedProvider: fd.get('embedProvider'),
    embedBaseUrl: str(fd, 'embedBaseUrl'),
    embedApiKey: str(fd, 'embedApiKey'),
    embedModel: fd.get('embedModel'),
    interestTags: str(fd, 'interestTags'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'invalid' };
  const v = parsed.data;

  const llmCfg = { provider: v.llmProvider, baseUrl: v.llmBaseUrl, apiKey: v.llmApiKey, model: v.llmModel };
  const embedCfg = { provider: v.embedProvider, baseUrl: v.embedBaseUrl, apiKey: v.embedApiKey, model: v.embedModel };

  const llmTest = await testLLM(llmCfg);
  if (!llmTest.ok) return { error: 'llmFailed' };
  const embTest = await testEmbedding(embedCfg);
  if (!embTest.ok) return { error: 'embedFailed' };
  if (embTest.dim !== env.EMBED_DIM) {
    return { error: 'dimMismatch', values: { got: embTest.dim ?? 0, want: env.EMBED_DIM } };
  }

  await updateSettings({
    locale: v.locale,
    llmProvider: v.llmProvider,
    llmBaseUrl: v.llmBaseUrl ?? null,
    llmApiKey: v.llmApiKey ?? null,
    llmModel: v.llmModel,
    llmCheapModel: v.llmCheapModel ?? v.llmModel,
    embedProvider: v.embedProvider,
    embedBaseUrl: v.embedBaseUrl ?? null,
    embedApiKey: v.embedApiKey ?? null,
    embedModel: v.embedModel,
    interestTags: (v.interestTags ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  });
  revalidatePath('/settings');
  return { ok: true };
}

export async function changePasswordAction(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  const pw = String(fd.get('newPassword') ?? '');
  if (pw.length < 8) return { error: 'passwordTooShort' };
  await setPasswordHash(await hashPassword(pw));
  return { ok: true };
}
```

- [ ] **Step 3: Create `apps/web/app/(authed)/settings/SettingsForm.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import type { UserSettings } from '@benkyou/core/settings';
import { updateSettingsAction, type SettingsState } from './actions';

const field = 'rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800';

export function SettingsForm({ settings, embedDim }: { settings: UserSettings; embedDim: number }) {
  const t = useTranslations('settings');
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateSettingsAction, {});

  const errorText =
    state.error === 'dimMismatch'
      ? t('dimMismatch', { got: state.values?.got ?? 0, want: state.values?.want ?? 0 })
      : state.error
        ? t(state.error as 'llmFailed')
        : null;

  return (
    <form action={action} className="flex flex-col gap-3">
      <select name="locale" defaultValue={settings.locale} className={field}>
        <option value="zh">中文</option>
        <option value="en">English</option>
      </select>

      <input name="llmProvider" required defaultValue={settings.llmProvider ?? ''} className={field} placeholder="llm provider" />
      <input name="llmBaseUrl" defaultValue={settings.llmBaseUrl ?? ''} className={field} placeholder="llm base url" />
      <input name="llmApiKey" type="password" defaultValue={settings.llmApiKey ?? ''} className={field} placeholder="llm api key" />
      <input name="llmModel" required defaultValue={settings.llmModel ?? ''} className={field} placeholder="llm model" />
      <input name="llmCheapModel" defaultValue={settings.llmCheapModel ?? ''} className={field} placeholder="llm cheap model" />

      <input name="embedProvider" required defaultValue={settings.embedProvider ?? ''} className={field} placeholder="embed provider" />
      <input name="embedBaseUrl" defaultValue={settings.embedBaseUrl ?? ''} className={field} placeholder="embed base url" />
      <input name="embedApiKey" type="password" defaultValue={settings.embedApiKey ?? ''} className={field} placeholder="embed api key" />
      <input name="embedModel" required defaultValue={settings.embedModel ?? ''} className={field} placeholder="embed model" />

      <p className="text-xs text-slate-500">{t('embedDimNote', { dim: embedDim })}</p>

      <input
        name="interestTags"
        defaultValue={(settings.interestTags ?? []).join(', ')}
        className={field}
        placeholder="interest tags"
      />

      {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}
      {state.ok ? <p className="text-sm text-green-600">{t('saved')}</p> : null}
      <button type="submit" disabled={pending} className="rounded bg-slate-900 p-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
        {t('save')}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Create `apps/web/app/(authed)/settings/PasswordForm.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { changePasswordAction, type SettingsState } from './actions';

export function PasswordForm() {
  const t = useTranslations('settings');
  const [state, action, pending] = useActionState<SettingsState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input
        type="password"
        name="newPassword"
        required
        placeholder={t('newPassword')}
        className="rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800"
      />
      {state.error ? <p className="text-sm text-red-600">{t('passwordTooShort')}</p> : null}
      {state.ok ? <p className="text-sm text-green-600">{t('passwordChanged')}</p> : null}
      <button type="submit" disabled={pending} className="rounded border border-slate-400 p-2 disabled:opacity-50">
        {t('changePassword')}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Create `apps/web/app/(authed)/settings/page.tsx`**

```tsx
import { getTranslations } from 'next-intl/server';
import { getUserSettings } from '@benkyou/core/settings';
import { SettingsForm } from './SettingsForm';
import { PasswordForm } from './PasswordForm';

export default async function SettingsPage() {
  const t = await getTranslations('settings');
  const settings = await getUserSettings();
  if (!settings) return null; // authed layout guarantees initialized; defensive

  return (
    <main className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-bold">{t('title')}</h1>
        <h2 className="mb-2 font-semibold">{t('providerSection')}</h2>
        <SettingsForm settings={settings} embedDim={settings.embedDim} />
      </section>
      <section>
        <h2 className="mb-2 font-semibold">{t('passwordSection')}</h2>
        <PasswordForm />
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Verify + commit**

```bash
pnpm check:i18n
pnpm --filter @benkyou/web typecheck
git add apps/web/app/\(authed\)/settings apps/web/messages
git commit -m "feat(web/settings): provider config + password change (embed_dim read-only)"
```

---

## Phase M1b.6 · Item detail + lazy streamed deep summary

### Task 13: Deep-summary core + streaming route + detail page

**Files:**
- Create: `packages/core/src/items/deep-summary.ts`
- Create: `apps/web/app/api/items/[id]/deep-summary/route.ts`
- Create: `apps/web/components/DeepSummary.tsx`, `apps/web/app/(authed)/items/[id]/page.tsx`
- Test: `packages/core/test/items/deep-summary.test.ts`
- Modify: `apps/web/messages/{zh,en}.json`

- [ ] **Step 1: Write the failing unit test for the prompt builder**

```ts
import { describe, expect, test } from 'vitest';
import { buildDeepSummaryPrompt } from '../../src/items/deep-summary.js';

describe('buildDeepSummaryPrompt', () => {
  test('includes language, title, body, and the section structure', () => {
    const p = buildDeepSummaryPrompt({ title: 'Transformers 101', rawContent: 'long body text' }, 'English');
    expect(p).toContain('English');
    expect(p).toContain('Transformers 101');
    expect(p).toContain('long body text');
    expect(p).toContain('TL;DR');
  });

  test('handles missing body', () => {
    const p = buildDeepSummaryPrompt({ title: 'T', rawContent: null }, 'Chinese');
    expect(p).toContain('Chinese');
    expect(p).toContain('(no body text available)');
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

```bash
pnpm --filter @benkyou/core exec vitest run test/items/deep-summary.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/items/deep-summary.ts`**

```ts
import { eq } from 'drizzle-orm';
import { getDbClient, items } from '../db';

export function buildDeepSummaryPrompt(
  item: { title: string; rawContent: string | null },
  lang: string,
): string {
  return [
    `Write a structured deep summary in ${lang} of the article below.`,
    'Use exactly these sections: "TL;DR" (1-2 sentences), "Key points" (3-6 bullets),',
    'and "What you\'ll learn" (1-3 bullets). No preamble.',
    '',
    `Title: ${item.title}`,
    (item.rawContent ?? '').slice(0, 12000) || '(no body text available)',
  ].join('\n');
}

export async function saveDeepSummary(id: string, text: string): Promise<void> {
  const db = getDbClient();
  await db
    .update(items)
    .set({ deepSummary: text, deepSummaryAt: new Date() })
    .where(eq(items.id, id));
}
```

(The `./items` barrel from Task 9 already re-exports these — if you stubbed that line, restore it now.)

- [ ] **Step 4: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/items/deep-summary.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Create the streaming route `apps/web/app/api/items/[id]/deep-summary/route.ts`**

```ts
import { streamText } from 'ai';
import { resolveLLM } from '@benkyou/core/ai';
import { buildLLMConfig, getUserSettings } from '@benkyou/core/settings';
import { buildDeepSummaryPrompt, getItemForUser, saveDeepSummary } from '@benkyou/core/items';
import { requireApiAuth } from '@/lib/auth';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;

  const { id } = await params;
  const item = await getItemForUser(id);
  if (!item) return new Response('Not found', { status: 404 });

  // Cached: return the stored summary as a plain stream-compatible body.
  if (item.deepSummary) {
    return new Response(item.deepSummary, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const settings = await getUserSettings();
  if (!settings) return new Response('Not configured', { status: 500 });

  const lang = settings.locale === 'en' ? 'English' : 'Chinese';
  const result = streamText({
    model: resolveLLM(buildLLMConfig(settings)), // main (not cheap) model
    prompt: buildDeepSummaryPrompt({ title: item.title, rawContent: item.rawContent }, lang),
    onFinish: async ({ text }) => {
      await saveDeepSummary(id, text); // persist once on completion (spec §6.2)
    },
  });
  return result.toTextStreamResponse();
}
```

- [ ] **Step 6: Add `item` i18n keys to BOTH message files**

`zh.json`: `"item": { "deepSummary": "AI 深度摘要", "generating": "正在生成…", "noSummary": "暂无摘要", "original": "原文", "noContent": "没有正文内容" }`

`en.json`: `"item": { "deepSummary": "AI deep summary", "generating": "Generating…", "noSummary": "No summary", "original": "Original", "noContent": "No content" }`

- [ ] **Step 7: Create `apps/web/components/DeepSummary.tsx`** (client island: streams on mount if uncached)

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

export function DeepSummary({ itemId, initial }: { itemId: string; initial: string | null }) {
  const t = useTranslations('item');
  const [text, setText] = useState(initial ?? '');
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (initial || started.current) return;
    started.current = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/items/${itemId}/deep-summary`, { method: 'POST' });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setText(acc);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [itemId, initial]);

  return (
    <section className="rounded border border-slate-200 p-3 dark:border-slate-700">
      <h2 className="mb-2 font-semibold">{t('deepSummary')}</h2>
      {text ? (
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>
      ) : (
        <p className="text-sm text-slate-500">{loading ? t('generating') : t('noSummary')}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Create `apps/web/app/(authed)/items/[id]/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getItemForUser } from '@benkyou/core/items';
import { DeepSummary } from '@/components/DeepSummary';

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getItemForUser(id);
  if (!item) notFound();
  const t = await getTranslations('item');

  return (
    <main className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">{item.title}</h1>
        <div className="mt-1 text-sm text-slate-500">
          {item.sourceName ? <span>{item.sourceName}</span> : null}
          {item.author ? <span> · {item.author}</span> : null}
          {item.publishedAt ? <span> · {new Date(item.publishedAt).toLocaleDateString()}</span> : null}
          {' · '}
          <a href={item.url} target="_blank" rel="noreferrer" className="underline">
            {t('original')}
          </a>
        </div>
      </header>

      <DeepSummary itemId={item.id} initial={item.deepSummary} />

      {item.rawContent ? (
        <article className="whitespace-pre-wrap text-sm leading-relaxed">{item.rawContent}</article>
      ) : (
        <p className="text-sm text-slate-500">{t('noContent')}</p>
      )}
    </main>
  );
}
```

- [ ] **Step 9: Verify + commit**

```bash
pnpm check:i18n
pnpm --filter @benkyou/core typecheck
pnpm --filter @benkyou/web typecheck
git add packages/core/src/items/deep-summary.ts packages/core/test/items/deep-summary.test.ts apps/web/app/api apps/web/app/\(authed\)/items apps/web/components/DeepSummary.tsx apps/web/messages
git commit -m "feat(web): item detail + lazy streamed deep summary"
```

---

## Phase M1b.7 · Hybrid search (lexical + vector + RRF + rerank)

> **Hard Invariant (AGENTS.md "Search filters are pre-applied"):** `state='done'` **and** all user filters go into the `WHERE` of **both** the lexical and vector candidate queries, before RRF. Never filter only after RRF.

### Task 14: Pure RRF merge

**Files:**
- Create: `packages/core/src/search/rrf.ts`
- Test: `packages/core/test/search/rrf.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import { rrfMerge } from '../../src/search/rrf.js';

describe('rrfMerge', () => {
  test('an item in both lists outranks an item in only one', () => {
    const scores = rrfMerge(['a', 'b'], ['a', 'c']); // a appears in both
    const ranked = [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    expect(ranked[0]).toBe('a');
  });

  test('uses 1/(k+rank) with k=60 and 1-based rank', () => {
    const scores = rrfMerge(['x'], []);
    expect(scores.get('x')).toBeCloseTo(1 / 61, 10);
  });
});
```

- [ ] **Step 2: Run it; confirm it fails, then implement `packages/core/src/search/rrf.ts`**

```bash
pnpm --filter @benkyou/core exec vitest run test/search/rrf.test.ts
```

```ts
// Reciprocal Rank Fusion. score(id) = Σ 1/(k + rank), rank 1-based per list.
export function rrfMerge(lexIds: string[], vecIds: string[], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  lexIds.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  vecIds.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  return scores;
}
```

- [ ] **Step 3: Run it; confirm it passes; commit**

```bash
pnpm --filter @benkyou/core exec vitest run test/search/rrf.test.ts
git add packages/core/src/search/rrf.ts packages/core/test/search/rrf.test.ts
git commit -m "feat(core/search): pure RRF merge"
```

---

### Task 15: `hybridSearch` + barrel + export

**Files:**
- Create: `packages/core/src/search/hybrid.ts`, `packages/core/src/search/index.ts`
- Modify: `packages/core/package.json` (add `./search` export)
- Test: `packages/core/test/search/hybrid.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

// Query embeds to the unit vector at index 0 (same direction as item A).
vi.mock('ai', () => ({
  embed: vi.fn(async () => {
    const a = Array.from({ length: 1536 }, () => 0);
    a[0] = 1;
    return { embedding: a };
  }),
}));

const unit = (pos: number): string => {
  const a = Array.from({ length: 1536 }, () => 0);
  a[pos] = 1;
  return `[${a.join(',')}]`;
};

describe('hybridSearch', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let hybridSearch: typeof import('../../src/search/hybrid.js').hybridSearch;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    const url = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
    process.env.DATABASE_URL = url;
    process.env.EMBED_DIM = '1536';
    process.env.SESSION_SECRET = 'a'.repeat(40);
    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations(url);
    sql = postgres(url);

    await sql`INSERT INTO user_settings (id, password_hash, embed_dim, embed_provider, embed_model)
      VALUES (1, 'x', 1536, 'openai', 'emb-x')`;
    await sql`INSERT INTO sources (id, type, name, config)
      VALUES ('11111111-1111-1111-1111-111111111111', 'rss', 'S', '{"url":"x"}')`;
    await sql`INSERT INTO items (id, source_id, url, url_hash, title, summary, content_type, state, depth_score, category) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','https://a','ha','Transformers explained','A deep dive into transformer models','article','done','0.7','knowledge'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111','https://b','hb','Cooking pasta','How to boil water','article','done','0.4','knowledge')`;
    await sql.unsafe(`INSERT INTO item_embeddings (item_id, embedding, title_emb) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','${unit(0)}','${unit(0)}'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','${unit(1)}','${unit(1)}')`);

    ({ hybridSearch } = await import('../../src/search/hybrid.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('ranks the lexically + vectorially relevant item first', async () => {
    const hits = await hybridSearch('transformers');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(hits[0]!.title).toBe('Transformers explained');
  });

  test('category filter excludes non-matching items (pre-applied)', async () => {
    expect(await hybridSearch('transformers', { category: 'news' })).toHaveLength(0);
    expect((await hybridSearch('transformers', { category: 'knowledge' })).length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it; confirm it fails, then implement `packages/core/src/search/hybrid.ts`**

```bash
pnpm --filter @benkyou/core exec vitest run test/search/hybrid.int.test.ts
```

```ts
import { sql } from 'drizzle-orm';
import { embed } from 'ai';
import { getDbClient } from '../db';
import { resolveEmbedding } from '../ai';
import { buildEmbeddingConfig, getUserSettings } from '../settings';
import { rrfMerge } from './rrf';

export interface SearchFilters {
  category?: 'news' | 'knowledge';
  sourceType?: string;
  bookmarkedOnly?: boolean;
  dateRange?: '24h' | '7d' | '30d' | 'all';
}

export interface SearchHit {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  category: string | null;
  sourceName: string | null;
  headline: string | null;
  score: number;
}

const CANDIDATES = 50;
const RRF_KEEP = 30;

// Shared filter fragment — used identically in BOTH candidate queries.
function filterSql(filters: SearchFilters) {
  const conds = [sql`i.state = 'done'`];
  if (filters.category) conds.push(sql`i.category = ${filters.category}`);
  if (filters.bookmarkedOnly) conds.push(sql`i.bookmarked = true`);
  if (filters.sourceType) conds.push(sql`s.type = ${filters.sourceType}`);
  if (filters.dateRange && filters.dateRange !== 'all') {
    const interval = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' }[filters.dateRange];
    conds.push(sql`coalesce(i.published_at, i.ingested_at) > now() - ${interval}::interval`);
  }
  return sql.join(conds, sql` AND `);
}

export async function hybridSearch(
  query: string,
  filters: SearchFilters = {},
  limit = 20,
): Promise<SearchHit[]> {
  const db = getDbClient();
  const settings = await getUserSettings();
  if (!settings) return [];

  const where = filterSql(filters);
  const tsq = sql`plainto_tsquery('simple', ${query})`;

  const lexRows = (await db.execute(sql`
    SELECT i.id::text AS id
    FROM items i LEFT JOIN sources s ON s.id = i.source_id
    WHERE ${where} AND i.search_vec @@ ${tsq}
    ORDER BY ts_rank(i.search_vec, ${tsq}) DESC
    LIMIT ${CANDIDATES}
  `)) as unknown as Array<{ id: string }>;

  const { embedding } = await embed({
    model: resolveEmbedding(buildEmbeddingConfig(settings)),
    value: query,
  });
  const vecLiteral = `[${embedding.join(',')}]`;
  const vecRows = (await db.execute(sql`
    SELECT i.id::text AS id
    FROM items i
    JOIN item_embeddings e ON e.item_id = i.id
    LEFT JOIN sources s ON s.id = i.source_id
    WHERE ${where}
    ORDER BY e.embedding <=> ${vecLiteral}::vector ASC
    LIMIT ${CANDIDATES}
  `)) as unknown as Array<{ id: string }>;

  const rrf = rrfMerge(
    lexRows.map((r) => r.id),
    vecRows.map((r) => r.id),
  );
  const ranked = [...rrf.entries()].sort((a, b) => b[1] - a[1]).slice(0, RRF_KEEP);
  if (ranked.length === 0) return [];
  const ids = ranked.map(([id]) => id);
  const rrfById = new Map(ranked);

  const adhoc = Number(settings.adhocSourceWeight ?? '1.0');
  const rows = (await db.execute(sql`
    SELECT i.id::text AS id, i.title, i.summary, i.url, i.category,
           s.name AS source_name,
           coalesce(i.depth_score, 0)::float8 AS depth,
           coalesce(s.weight, ${adhoc})::float8 AS eff_weight,
           ts_headline('simple', coalesce(i.summary, i.title), ${tsq}, 'StartSel=,StopSel=,MaxFragments=1') AS headline
    FROM items i LEFT JOIN sources s ON s.id = i.source_id
    WHERE i.id = ANY(${ids}::uuid[])
  `)) as unknown as Array<{
    id: string;
    title: string;
    summary: string | null;
    url: string;
    category: string | null;
    source_name: string | null;
    depth: number;
    eff_weight: number;
    headline: string | null;
  }>;

  // Quality rerank: final = α·rrf + β·depth + γ·effective_weight.
  // (Search multiplies α by rrf_score; digest multiplies α by topic_score — spec §6.3.)
  const alpha = Number(settings.weightAlpha ?? '0.6');
  const beta = Number(settings.weightBeta ?? '0.3');
  const gamma = Number(settings.weightGamma ?? '0.1');

  const hits: SearchHit[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    url: r.url,
    category: r.category,
    sourceName: r.source_name,
    headline: r.headline,
    score: alpha * (rrfById.get(r.id) ?? 0) + beta * r.depth + gamma * r.eff_weight,
  }));
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
```

> If `db.execute` returns `{ rows: [...] }` rather than the array directly on your Drizzle/driver versions, read `.rows`. The M0 `/health` route uses `db.execute(sql\`SELECT 1\`)`; mirror whatever shape it returns. Adjust the casts accordingly — do not add `any`.

- [ ] **Step 3: Write the barrel `packages/core/src/search/index.ts`**

```ts
export { hybridSearch } from './hybrid';
export type { SearchFilters, SearchHit } from './hybrid';
export { rrfMerge } from './rrf';
```

- [ ] **Step 4: Add the `./search` export to `packages/core/package.json`**

```json
"./search": "./src/search/index.ts",
```

- [ ] **Step 5: Run it; confirm it passes; commit**

```bash
pnpm --filter @benkyou/core exec vitest run test/search/hybrid.int.test.ts
git add packages/core/src/search packages/core/test/search/hybrid.int.test.ts packages/core/package.json
git commit -m "feat(core/search): hybrid ts_rank + vector + RRF + quality rerank, filters pre-applied"
```

---

### Task 16: `/search` page

**Files:**
- Create: `apps/web/app/(authed)/search/page.tsx`
- Modify: `apps/web/messages/{zh,en}.json`

- [ ] **Step 1: Add `search` i18n keys to BOTH message files**

`zh.json`: `"search": { "title": "搜索", "placeholder": "搜索内容…", "noResults": "没有找到结果" }`

`en.json`: `"search": { "title": "Search", "placeholder": "Search…", "noResults": "No results" }`

- [ ] **Step 2: Create `apps/web/app/(authed)/search/page.tsx`**

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { hybridSearch } from '@benkyou/core/search';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const t = await getTranslations('search');
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const hits = query ? await hybridSearch(query, {}, 20) : [];

  return (
    <main>
      <h1 className="mb-4 text-xl font-bold">{t('title')}</h1>
      <form action="/search" method="get" className="mb-4">
        <input
          name="q"
          defaultValue={query}
          placeholder={t('placeholder')}
          className="w-full rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800"
        />
      </form>

      {query && hits.length === 0 ? <p className="text-slate-500">{t('noResults')}</p> : null}

      <div className="flex flex-col gap-3">
        {hits.map((h) => (
          <article key={h.id} className="rounded border border-slate-200 p-3 dark:border-slate-700">
            <div className="mb-1 text-xs text-slate-500">
              {h.sourceName ?? ''}
              {h.category ? ` · ${h.category === 'news' ? '📰' : '📚'}` : ''}
            </div>
            <h2 className="font-semibold">
              <Link href={`/items/${h.id}`}>{h.title}</Link>
            </h2>
            {h.headline ?? h.summary ? (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{h.headline ?? h.summary}</p>
            ) : null}
          </article>
        ))}
      </div>
    </main>
  );
}
```

> `ts_headline` here is rendered as **plain text** (empty `StartSel`/`StopSel`), so React's auto-escaping keeps it XSS-safe. `<mark>` highlighting is a deliberate M5 polish — it needs sanitization since `raw_content`/feed titles are untrusted.

- [ ] **Step 3: Verify + commit**

```bash
pnpm check:i18n
pnpm --filter @benkyou/web typecheck
git add apps/web/app/\(authed\)/search apps/web/messages
git commit -m "feat(web/search): hybrid search results page"
```

---

## Phase M1b.8 · E2E golden path + verification

> **Test split (be honest about it):** `/setup`, `/settings` save, and `/search` all make **live** LLM/embedding calls (connectivity tests; query embedding), so they're covered by the **core integration tests** (Phases M1b.3/.5/.7), not E2E. The Playwright golden path covers the provider-free surface: the auth gate, login, feed render, detail with a **pre-seeded** (cached) deep summary, and logout. The full setup→fetch→appears-on-feed loop is the **manual smoke** in Task 18 (needs real endpoints).

### Task 17: Playwright golden path (login → feed → detail → logout)

**Files:**
- Create: `apps/web/e2e/global-setup.ts`, `apps/web/e2e/golden-path.spec.ts`
- Modify: `apps/web/playwright.config.ts`

- [ ] **Step 1: Update `apps/web/playwright.config.ts`** (add `globalSetup` + `webServer`; keep the existing `testDir`/`reporter`/`use`)

```ts
import { defineConfig } from '@playwright/test';

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
  },
  webServer: {
    command: 'pnpm --filter @benkyou/web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL,
      EMBED_DIM: '1536',
      SESSION_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      DEPLOY_MODE: 'docker',
    },
  },
});
```

- [ ] **Step 2: Create `apps/web/e2e/global-setup.ts`** (migrate + seed a known password, one `done` item with a cached deep summary)

```ts
import { execSync } from 'node:child_process';
import postgres from 'postgres';
import { hashPassword } from '@benkyou/core/auth';

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou';

export default async function globalSetup(): Promise<void> {
  const migrateEnv = {
    ...process.env,
    DATABASE_URL,
    EMBED_DIM: '1536',
    SESSION_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };
  // Assumes `docker compose up -d postgres` is already running (CI does this first).
  execSync('pnpm migrate', { stdio: 'inherit', env: migrateEnv });

  const sql = postgres(DATABASE_URL);
  try {
    await sql`TRUNCATE items, item_embeddings, sessions, sources, user_settings, event_clusters RESTART IDENTITY CASCADE`;
    const passwordHash = await hashPassword('e2e-password');
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, locale, llm_provider, llm_model, embed_provider, embed_model)
      VALUES (1, ${passwordHash}, 1536, 'en', 'openai', 'gpt-x', 'openai', 'emb-x')`;
    await sql`INSERT INTO sources (id, type, name, config)
      VALUES ('11111111-1111-1111-1111-111111111111', 'rss', 'Seed Feed', '{"url":"x"}')`;
    await sql`INSERT INTO items
      (id, source_id, url, url_hash, title, summary, raw_content, deep_summary, content_type, state, published_at, depth_score, category)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',
        'https://example.com/seeded','seedhash','Seeded Article','A seeded summary line.',
        'Full seeded body content.','TL;DR seeded deep summary.','article','done', now(), '0.6','knowledge')`;
  } finally {
    await sql.end();
  }
}
```

- [ ] **Step 3: Create `apps/web/e2e/golden-path.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('golden path: gate → login → feed → detail → logout', async ({ page, context }) => {
  // Force English UI so assertions are stable (locale is a next-intl cookie, default zh).
  await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);

  // Unauthenticated → redirected to /login by middleware.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);

  // Wrong password → error.
  await page.fill('input[name="password"]', 'nope');
  await page.click('button[type="submit"]');
  await expect(page.getByText(/wrong password/i)).toBeVisible();

  // Correct password → home feed with the seeded item.
  await page.fill('input[name="password"]', 'e2e-password');
  await page.click('button[type="submit"]');
  await expect(page.getByRole('link', { name: 'Seeded Article' })).toBeVisible();

  // Detail page shows cached deep summary + body (no LLM call).
  await page.getByRole('link', { name: 'Seeded Article' }).click();
  await expect(page.getByRole('heading', { name: 'Seeded Article' })).toBeVisible();
  await expect(page.getByText('TL;DR seeded deep summary.')).toBeVisible();
  await expect(page.getByText('Full seeded body content.')).toBeVisible();

  // Logout → back to /login.
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 4: Run the golden path locally**

```bash
docker compose up -d postgres
pnpm --filter @benkyou/web exec playwright install --with-deps chromium
pnpm --filter @benkyou/web test:e2e
```

Expected: 1 test passes (Playwright boots the web dev server itself via `webServer`). The M0 `smoke.spec.ts` (`/health` + home `<h1>`) will now fail its "home `<h1>` = Benkyou" assertion because `/` is gated — update or remove that M0 assertion as part of this task (the `/health` half still passes).

- [ ] **Step 5: Fix the M0 smoke test for the new gated home**

Replace `apps/web/e2e/smoke.spec.ts`'s "home page renders" test with a redirect check:

```ts
test('home redirects unauthenticated users to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e apps/web/playwright.config.ts
git commit -m "test(web): playwright golden path (auth gate → login → feed → detail → logout)"
```

---

### Task 18: Full M1 verification (manual end-to-end smoke) + sign-off

- [ ] **Step 1: Confirm the consolidated `@benkyou/core` exports map**

`packages/core/package.json` `exports` should now contain all of: `.`, `./db`, `./ai`, `./queue`, `./pipeline`, `./settings`, `./sources`, `./config`, `./auth`, `./items`, `./search`, `./setup`. Add any that a prior task missed.

- [ ] **Step 2: Run the full CI gate**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm test
```

Expected: all green (core unit + integration suites for auth, setup, items, search, pipeline; web unit). Integration suites need Docker for Testcontainers.

- [ ] **Step 3: Manual full-loop smoke with REAL providers (the actual M1 deliverable)**

```bash
cp .env.example .env
echo "SESSION_SECRET=$(openssl rand -base64 32)" >> .env
echo "INITIAL_PASSWORD=changeme-12345678" >> .env
# Set EMBED_DIM in .env to match your embedding model (e.g. 1536 for text-embedding-3-small).

docker compose up -d postgres
DATABASE_URL=postgres://benkyou:benkyou@localhost:5432/benkyou pnpm migrate

# Start web + worker (worker drains the pipeline in docker mode):
pnpm dev
```

Then in a browser:
1. Visit `http://localhost:3000` → redirected to `/setup`.
2. Fill LLM + embedding endpoints (real), interests, and one RSS source (e.g. `https://simonwillison.net/atom/everything/`). Submit — connectivity tests must pass; embedding dim must equal `EMBED_DIM`.
3. You're auto-logged-in and landed on the feed (empty at first).
4. Wait ~1–2 min (worker ingests → extract → embed → score → dedup → summary). Refresh `/` → the first items appear with summaries.
5. Open an item → its deep summary streams in; reload → it's cached.
6. `/search?q=<topic>` → the item is found.
7. `/settings` → change a provider field (re-tested on save) and the password; log out; log back in with the new password.

Expected: every step works. If the feed stays empty, check `state` distribution:

```bash
docker compose exec -T postgres psql -U benkyou -d benkyou \
  -c "SELECT state, current_stage, count(*) FROM items GROUP BY 1,2 ORDER BY 1;"
```

Anything stuck in `failed` shows the blocking stage in `current_stage` and the reason in `last_error` — that's the M3 `/admin/jobs` surface, inspectable via SQL for now.

- [ ] **Step 4: Tear down**

```bash
docker compose down
```

- [ ] **Step 5: Commit any fixes, open the M1 PR**

```bash
git add -A
git commit -m "chore(m1): final verification fixes"
```

---

## M1b self-review (planner)

**Spec coverage:**

| Spec item | Where |
|---|---|
| §10 session auth (argon2id, sessions, sliding+absolute) | Tasks 2–3 |
| §10.1 login/logout flow, HttpOnly/SameSite cookie | Tasks 6 |
| §11.4 Phase-1 onboarding (INITIAL_PASSWORD, endpoint form + connectivity test, add source, trigger fetch) | Tasks 7–8 |
| §9.1 routes `/login`,`/setup`,`/`,`/items/[id]`,`/search`,`/settings` | Tasks 6,8,10,13,16,12 |
| §6.2 deep_summary (lazy, streamed, cached) | Task 13 |
| §7.1 hybrid search (filters pre-applied in both candidates, RRF, α/β/γ rerank, ts_headline) | Tasks 14–16 |
| §11.2 serverless `/api/cron/work` → `processBatch` | Task 7-pre |
| §12 i18n (zh/en for every string, `check:i18n`) | every UI task |
| §13 testing (unit RRF/prompts/password; integration sessions/setup/items/search; E2E golden path) | throughout |

**Deferred (explicitly, not silently):** CSRF token + login rate-limiting (M5); `<mark>` highlight sanitization (M5); infinite scroll (M5); bookmarks UI, sources-management UI, weight-tuning UI, digest/home two-column (M3); ad-hoc URL paste + video (M2); agent/chat (M4). The home page shows the **feed only** — the digest column is M3.

**Placeholder scan:** none — every task ships runnable code or exact config. **Type consistency:** `SESSION_COOKIE`, `getValidSession`/`requireAuth`/`requireApiAuth`, `SetupInput`/`completeSetup`, `FeedItem`/`ItemDetail`/`getItemForUser`, `SearchFilters`/`SearchHit`/`hybridSearch`, `SettingsPatch`/`updateSettings`/`setPasswordHash` are consistent across core and web. Core export subpaths added per task and consolidated in Task 18 Step 1.

**Cross-plan seam:** M1b's `/setup` (Task 8) writes the `user_settings` row + `sources` row and calls `triggerSourceFetch` → the M1a pipeline consumes them. The two plans meet exactly at `user_settings` (written by M1b, read by M1a stages) and the `ingest` queue (enqueued by M1b setup, drained by M1a worker).

---

## ✅ Execution handoff (for BOTH M1a and M1b)

Plans saved:
- `docs/superpowers/plans/2026-05-31-benkyou-m1a-pipeline.md` (headless pipeline/worker)
- `docs/superpowers/plans/2026-05-31-benkyou-m1b-product.md` (this — auth/setup/feed/detail/search)

**Order:** execute **M1a to green first** (its integration test proves the pipeline), then **M1b** (whose `/setup` and golden path assume the pipeline exists). Don't interleave — M1b's manual smoke depends on M1a's worker draining the queue.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in this session with checkpoints. REQUIRED SUB-SKILL: `superpowers:executing-plans`.

**Which approach, and shall I start with M1a?**

