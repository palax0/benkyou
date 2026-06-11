# M1c · Observability & Source Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ingest→done pipeline observable (token ledger + `/admin/jobs` panel + retry), give RSS sources a management UI (`/sources` CRUD + per-source status + fetch-now), wire feed cards to per-source filtering, and stop forms from clearing user input on error.

**Architecture:** All query/mutation logic lives in `@benkyou/core` (decision §2: keeps the transport layer swappable). The web app adds thin RSC pages + server actions that call into core, plus a single client `<AutoRefresh>` component that polls `router.refresh()` while its tab is visible. A new `ai_usage` ledger table records every LLM/embedding call best-effort from a single chokepoint in `core/ai`. No SSE, no new long-lived connections (honors the "two deploy modes, one codebase" hard invariant).

**Tech Stack:** Next.js 16 App Router (RSC + server actions), Drizzle ORM 0.45+, PostgreSQL 16 + pgvector, pg-boss 12, Vercel AI SDK 6, Vitest 4 + Testcontainers 12 + MSW, Playwright 1.60+, next-intl 4, Zod 4.

---

## Spec deviations (read first — flagged, not silent)

The spec (`docs/superpowers/specs/2026-06-10-m1c-observability-design.md`) is the source of truth, but reading the current code turned up three mismatches. This plan implements the **corrected** behavior and updates the spec in Task 19.

1. **Four live AI call sites, not three.** Spec §5 lists "embed / extract's summary / deep-summary" and §4.1 defers `score` to "M3+". In the current code:
   - `packages/core/src/pipeline/embed.ts` → `embedMany` (embedding) — stage `embed`.
   - `packages/core/src/pipeline/score.ts` → `generateObject` (LLM) — stage `score`. **Live in M1**, the spec missed it; only *depth* scoring is stubbed, topic scoring is a real LLM call.
   - `packages/core/src/pipeline/summary.ts` → `generateText` (LLM) — stage `summary` (the last per-item stage, *not* "inside extract").
   - `packages/core/src/items/deep-summary.ts` → `streamText` (LLM) — stage `deep_summary`.
   `packages/core/src/pipeline/extract.ts` makes **no** AI call (Readability only). `testLLM`/`testEmbedding` in `setup/index.ts` are connectivity pings and are intentionally **not** recorded. → Instrument all four real sites with the stage labels above.

2. **`items` has no `updated_at` column**, but panel §6.1 requires "oldest-un-moved first" and "stalled >30 min". → Add `items.updated_at` and bump it in the state-transition helpers (`beginStage`/`completeStage`/`recordFailure`/`markFailed`).

3. **`triggerSourceFetch` currently lives in `setup/index.ts`.** The `/sources` page needs the same enqueue-a-fetch behavior. → Relocate the canonical implementation to `sources/manage.ts`, re-export it from `setup/index.ts` so `apps/web/app/setup/actions.ts` keeps working unchanged.

---

## File Structure

**Create (core):**
- `packages/core/src/ai/usage.ts` — `recordUsage(ctx, fields)` best-effort ledger writer + `UsageContext`/`UsageFields` types. The single token-recording chokepoint.
- `packages/core/src/sources/manage.ts` — source CRUD: `listSourcesWithStats`, `createSource`, `updateSource`, `deleteSource`, `setSourceEnabled`, `triggerSourceFetch`.
- `packages/core/src/pipeline/status.ts` — read-only panel queries: `getStateCounts`, `getQueueHealth`, `getOrphans`, `getInFlight`, `getFailed`, `getTokenSummary`, `getTokenTopItems`, `getTokenNoItem`, `getDimensionDrift`, `getPipelineStatus` (composes them).
- `packages/core/src/pipeline/retry.ts` — `retryItem(itemId)`.

**Modify (core):**
- `packages/core/src/db/schema.ts` — add `aiUsage` table, `sources.lastFetchError`, `items.updatedAt`.
- `packages/core/src/ai/index.ts` — re-export `./usage`.
- `packages/core/src/pipeline/{embed,score,summary}.ts` + `items/deep-summary.ts` — record usage.
- `packages/core/src/pipeline/state.ts` — bump `items.updated_at` on transitions.
- `packages/core/src/pipeline/ingest.ts` — write/clear `sources.last_fetch_error`.
- `packages/core/src/items/queries.ts` — `listFeed` gains `sourceId` filter; add `sourceName`/`sourceId` to `FeedItem`; add `getSourceName(id)`.
- `packages/core/src/setup/index.ts` — import/re-export relocated `triggerSourceFetch`.
- `packages/core/src/pipeline/index.ts` — export status/retry barrels.
- `packages/core/src/sources/index.ts` — export `./manage`.

**Create (web):**
- `apps/web/components/AutoRefresh.tsx` — `'use client'` visibility-gated 5s `router.refresh()` with pause toggle + last-refreshed label.
- `apps/web/components/SourceBadge.tsx` — clickable source chip.
- `apps/web/app/(authed)/sources/page.tsx` + `actions.ts` + `SourceList.tsx` + `AddSourceForm.tsx` + `EditSourceForm.tsx` + `DeleteSourceForm.tsx`.
- `apps/web/app/(authed)/admin/jobs/page.tsx` + `actions.ts` + `RetryButton.tsx`.

**Modify (web):**
- `apps/web/app/(authed)/layout.tsx` — nav links for Pipeline + Sources.
- `apps/web/app/(authed)/page.tsx` — accept `?source=`, render filter banner, keep param in pagination.
- `apps/web/components/ItemCard.tsx` — source name → clickable `<SourceBadge>`.
- `apps/web/app/(authed)/settings/actions.ts` + `SettingsForm.tsx` — return `{ error, values }`, repopulate from `state.values`.
- `apps/web/app/setup/actions.ts` + `SetupForm.tsx` — same retention pattern.
- `apps/web/messages/zh.json` + `en.json` — new `sources`, `jobs` namespaces; extend `nav`, `feed`.

**Create (tests):**
- `packages/core/test/ai/usage.int.test.ts`, `packages/core/test/pipeline/usage-points.int.test.ts`, `packages/core/test/sources/manage.int.test.ts`, `packages/core/test/pipeline/status.int.test.ts`, `packages/core/test/pipeline/retry.int.test.ts`, `packages/core/test/items/feed-filter.int.test.ts`, `packages/core/test/pipeline/ingest-error.int.test.ts`.
- `apps/web/e2e/rss-mock-server.ts` (new mock feed), `apps/web/e2e/sources.spec.ts`, `apps/web/e2e/jobs-retry.spec.ts`, `apps/web/e2e/form-retention.spec.ts`.
- Modify `apps/web/e2e/provider-mock-server.ts` (structured-output JSON for the score stage), `apps/web/e2e/global-setup.ts` (seed mock provider), `apps/web/playwright.config.ts` (mock-RSS webServer entry), `apps/web/app/(authed)/settings/actions.test.ts` (retention regression).

---

## Phase A — Schema & migration

### Task 1: Add `ai_usage`, `sources.last_fetch_error`, `items.updated_at`

**Files:**
- Modify: `packages/core/src/db/schema.ts`
- Generate: `packages/core/src/db/migrations/0003_*.sql`

- [ ] **Step 1: Add `bigserial` to the drizzle import**

In `packages/core/src/db/schema.ts`, the import block currently lists `pgTable, text, integer, uuid, timestamp, boolean, numeric, jsonb, primaryKey, uniqueIndex, index, date, customType`. Add `bigserial`:

```ts
import {
  pgTable,
  text,
  integer,
  bigserial,
  uuid,
  timestamp,
  boolean,
  numeric,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  date,
  customType,
} from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: Add `lastFetchError` to the `sources` table**

In the `sources` `pgTable`, add the column after `lastPolledAt`:

```ts
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  lastFetchError: text('last_fetch_error'), // NULL = last fetch succeeded
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
```

- [ ] **Step 3: Add `updatedAt` to the `items` table**

In the `items` `pgTable` column list, add right after `ingestedAt`:

```ts
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
```

And add an index in the `items` index callback (so "oldest-un-moved first" is cheap):

```ts
    bookmarkedIdx: index('items_bookmarked_idx')
      .on(t.bookmarked)
      .where(sql`bookmarked = true`),
    updatedAtIdx: index('items_updated_at_idx').on(t.updatedAt),
    searchVecIdx: index('items_search_vec_idx').using('gin', t.searchVec),
```

- [ ] **Step 4: Add the `ai_usage` table**

Append after the `itemEmbeddings` table (it references `items`, already declared above it):

```ts
/* ─── ai_usage ─── (per-call token ledger; aggregates derive from this) */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // agent/search calls have no item; keep the ledger row after the item is deleted.
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    stage: text('stage').notNull(), // 'embed' | 'score' | 'summary' | 'deep_summary' | (M3+ more)
    kind: text('kind').notNull(), // 'llm' | 'embedding'
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'), // NULL for embeddings
    totalTokens: integer('total_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    createdAtIdx: index('ai_usage_created_at_idx').on(t.createdAt),
    itemIdx: index('ai_usage_item_idx').on(t.itemId),
  }),
);
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm --filter @benkyou/core exec drizzle-kit generate`
Expected: a new file `packages/core/src/db/migrations/0003_<name>.sql` containing `CREATE TABLE "ai_usage" ...`, `ALTER TABLE "sources" ADD COLUMN "last_fetch_error" text;`, `ALTER TABLE "items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();`, and the two new indexes.

- [ ] **Step 6: Review the generated SQL**

Read the new `0003_*.sql`. Confirm: `id` is `bigserial`/`bigint generated ... as identity` PK; `item_id` FK has `ON DELETE SET NULL`; `ai_usage_created_at_idx` and `ai_usage_item_idx` exist; `items_updated_at_idx` exists. No vector/tsvector touched, so no hand-edit expected.

- [ ] **Step 7: Verify it applies against a fresh container**

Run: `pnpm --filter @benkyou/core test -- test/db.test.ts`
Expected: PASS — migration applies cleanly.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/migrations
git commit -m "feat(db): add ai_usage ledger, sources.last_fetch_error, items.updated_at"
```

---

## Phase B — Core: usage ledger & instrumentation

### Task 2: `recordUsage` ledger writer

**Files:**
- Create: `packages/core/src/ai/usage.ts`
- Modify: `packages/core/src/ai/index.ts`
- Test: `packages/core/test/ai/usage.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/ai/usage.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

type UsageModule = typeof import('../../src/ai/usage.js');

describe('recordUsage', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let usage: UsageModule;
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
    usage = await import('../../src/ai/usage.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  test('writes a ledger row with all fields', async () => {
    await usage.recordUsage(
      { stage: 'embed', itemId: null },
      { kind: 'embedding', model: 'emb-x', inputTokens: 10, outputTokens: null, totalTokens: 10 },
    );
    const rows = await sql<{ stage: string; kind: string; model: string; total_tokens: number }[]>`
      SELECT stage, kind, model, total_tokens FROM ai_usage`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stage: 'embed', kind: 'embedding', model: 'emb-x', total_tokens: 10 });
  });

  test('a write failure never throws (best-effort)', async () => {
    // stage is NOT NULL; passing a value that violates the schema must be swallowed.
    await expect(
      usage.recordUsage(
        { stage: undefined as unknown as string, itemId: null },
        { kind: 'llm', model: 'm', inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      ),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @benkyou/core test -- test/ai/usage.int.test.ts`
Expected: FAIL — `Cannot find module '../../src/ai/usage.js'`.

- [ ] **Step 3: Implement `recordUsage`**

Create `packages/core/src/ai/usage.ts`:

```ts
import { getDbClient, aiUsage } from '../db';

export interface UsageContext {
  stage: string;
  itemId?: string | null;
}

export interface UsageFields {
  kind: 'llm' | 'embedding';
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

/**
 * Best-effort token ledger write (spec §7): a failure here is logged and
 * swallowed — it must never break the pipeline stage that produced the usage.
 */
export async function recordUsage(ctx: UsageContext, fields: UsageFields): Promise<void> {
  try {
    const db = getDbClient();
    await db.insert(aiUsage).values({
      itemId: ctx.itemId ?? null,
      stage: ctx.stage,
      kind: fields.kind,
      model: fields.model,
      inputTokens: fields.inputTokens,
      outputTokens: fields.outputTokens,
      totalTokens: fields.totalTokens,
    });
  } catch (err) {
    console.error('[ai_usage] record failed:', err instanceof Error ? err.message : err);
  }
}
```

- [ ] **Step 4: Re-export from the ai barrel**

In `packages/core/src/ai/index.ts`:

```ts
export * from './provider';
export * from './usage';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @benkyou/core test -- test/ai/usage.int.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ai/usage.ts packages/core/src/ai/index.ts packages/core/test/ai/usage.int.test.ts
git commit -m "feat(core): add best-effort ai_usage ledger writer"
```

### Task 3: Instrument the four live AI call sites

**Files:**
- Modify: `packages/core/src/pipeline/embed.ts`, `score.ts`, `summary.ts`, `packages/core/src/items/deep-summary.ts`
- Test: `packages/core/test/pipeline/usage-points.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/pipeline/usage-points.int.test.ts`. It mocks `ai` so each stage returns a known `usage`, runs the stage, and asserts a matching `ai_usage` row:

```ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';

vi.mock('ai', () => ({
  embedMany: vi.fn(async () => ({
    embeddings: [Array.from({ length: 1536 }, () => 0.01), Array.from({ length: 1536 }, () => 0.02)],
    usage: { tokens: 42 },
  })),
  generateObject: vi.fn(async () => ({
    object: { topic_tags: ['llm'], topic_score: 0.8, category: 'knowledge' },
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  })),
  generateText: vi.fn(async () => ({
    text: 'A concise summary.',
    usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
  })),
}));

describe('AI call sites record usage', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let embedItem: (id: string) => Promise<void>;
  let scoreItem: (id: string) => Promise<void>;
  let summarizeItem: (id: string) => Promise<void>;
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
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, locale, llm_provider, llm_model, llm_cheap_model, embed_provider, embed_model, interest_tags)
      VALUES (1,'x',1536,'en','openai','gpt-x','gpt-x-mini','openai','emb-x',ARRAY['llm'])`;
    ({ embedItem } = await import('../../src/pipeline/embed.js'));
    ({ scoreItem } = await import('../../src/pipeline/score.js'));
    ({ summarizeItem } = await import('../../src/pipeline/summary.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
  });

  async function seedItem(state: string): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, raw_content, state)
      VALUES ('https://x/'||gen_random_uuid(), gen_random_uuid()::text, 'T', 'article', 'body', ${state})
      RETURNING id`;
    return rows[0]!.id;
  }

  test('embed records an embedding row', async () => {
    const id = await seedItem('extracted');
    await embedItem(id);
    const r = await sql<{ stage: string; kind: string; total_tokens: number; output_tokens: number | null }[]>`
      SELECT stage, kind, total_tokens, output_tokens FROM ai_usage WHERE item_id = ${id}`;
    expect(r).toEqual([{ stage: 'embed', kind: 'embedding', total_tokens: 42, output_tokens: null }]);
  });

  test('score records an llm row', async () => {
    const id = await seedItem('embedded');
    await scoreItem(id);
    const r = await sql<{ stage: string; kind: string; total_tokens: number }[]>`
      SELECT stage, kind, total_tokens FROM ai_usage WHERE item_id = ${id}`;
    expect(r).toEqual([{ stage: 'score', kind: 'llm', total_tokens: 120 }]);
  });

  test('summary records an llm row', async () => {
    const id = await seedItem('dedup_done');
    await summarizeItem(id);
    const r = await sql<{ stage: string; kind: string; total_tokens: number }[]>`
      SELECT stage, kind, total_tokens FROM ai_usage WHERE item_id = ${id}`;
    expect(r).toEqual([{ stage: 'summary', kind: 'llm', total_tokens: 60 }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @benkyou/core test -- test/pipeline/usage-points.int.test.ts`
Expected: FAIL — `ai_usage` rows are empty (stages don't record yet).

- [ ] **Step 3: Instrument `embed.ts`**

In `packages/core/src/pipeline/embed.ts`, change the import line and capture `usage`, recording immediately after the `embedMany` await (before the dim guard — usage is real even if the guard later throws):

```ts
import { resolveEmbedding, embeddingProviderOptions, recordUsage } from '../ai';
```

```ts
  const { embeddings, usage } = await embedMany({
    model,
    values: [docText, item.title],
    providerOptions: embeddingProviderOptions(cfg),
  });
  await recordUsage(
    { stage: 'embed', itemId },
    { kind: 'embedding', model: cfg.model, inputTokens: usage?.tokens ?? null, outputTokens: null, totalTokens: usage?.tokens ?? null },
  );
```

- [ ] **Step 4: Instrument `score.ts`**

In `packages/core/src/pipeline/score.ts`:

```ts
import { resolveLLM, recordUsage } from '../ai';
```

```ts
  const { object, usage } = await generateObject({ model: resolveLLM(cfg), schema: scoreSchema, prompt });
  await recordUsage(
    { stage: 'score', itemId },
    { kind: 'llm', model: cfg.model, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null },
  );
```

- [ ] **Step 5: Instrument `summary.ts`**

In `packages/core/src/pipeline/summary.ts`:

```ts
import { resolveLLM, recordUsage } from '../ai';
```

```ts
  const { text, usage } = await generateText({ model: resolveLLM(cfg), prompt });
  await recordUsage(
    { stage: 'summary', itemId },
    { kind: 'llm', model: cfg.model, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null },
  );
```

- [ ] **Step 6: Instrument `deep-summary.ts`**

In `packages/core/src/items/deep-summary.ts`, import `recordUsage` and record in `onFinish` (which receives `usage`). Note `settings` is already in scope in `streamDeepSummaryResponse`:

```ts
import { resolveLLM } from '../ai/provider';
import { recordUsage } from '../ai/usage';
```

```ts
    onFinish: async ({ text, usage }: { text: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }) => {
      await saveDeepSummary(id, text); // persist once on completion (spec §6.2)
      await recordUsage(
        { stage: 'deep_summary', itemId: id },
        { kind: 'llm', model: buildLLMConfig(settings).model, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null },
      );
    },
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @benkyou/core test -- test/pipeline/usage-points.int.test.ts`
Expected: PASS (embed, score, summary).

- [ ] **Step 8: Confirm no regression in the full pipeline test**

Run: `pnpm --filter @benkyou/core test -- test/pipeline/pipeline.int.test.ts`
Expected: PASS — its `ai` mock returns no `usage`; `recordUsage` writes NULL token columns via optional chaining without throwing, the pipeline still reaches `done`.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/pipeline/embed.ts packages/core/src/pipeline/score.ts packages/core/src/pipeline/summary.ts packages/core/src/items/deep-summary.ts packages/core/test/pipeline/usage-points.int.test.ts
git commit -m "feat(core): record token usage from embed/score/summary/deep-summary"
```

---

## Phase C — Core: state-machine `updated_at`, ingest error capture

### Task 4: Bump `items.updated_at` on every stage transition

**Files:**
- Modify: `packages/core/src/pipeline/state.ts`
- Test: `packages/core/test/pipeline/updated-at.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/pipeline/updated-at.int.test.ts` (container + migrations boilerplate copied from Task 2's test):

```ts
test('beginStage and completeStage bump updated_at', async () => {
  const ins = await sql<{ id: string }[]>`
    INSERT INTO items (url, url_hash, title, content_type, state, current_stage, updated_at)
    VALUES ('https://u', 'uh', 'T', 'article', 'pending', 'extract', now() - interval '1 hour')
    RETURNING id`;
  const id = ins[0]!.id;
  const { beginStage, completeStage } = await import('../../src/pipeline/state.js');
  await beginStage(id, 'extract');
  const a = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM items WHERE id = ${id}`;
  expect(Date.now() - new Date(a[0]!.updated_at).getTime()).toBeLessThan(60_000);
  await completeStage(id, 'extract');
  const b = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM items WHERE id = ${id}`;
  expect(new Date(b[0]!.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(a[0]!.updated_at).getTime());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @benkyou/core test -- test/pipeline/updated-at.int.test.ts`
Expected: FAIL — `updated_at` is still ~1 hour old after `beginStage` (helpers don't touch it).

- [ ] **Step 3: Add `updatedAt: sql\`now()\`` to the four set-clauses**

In `packages/core/src/pipeline/state.ts` (the `sql` import already exists), add `updatedAt: sql\`now()\`` to the `.set({...})` in `beginStage`, `completeStage`, `recordFailure`, and `markFailed`:

```ts
// beginStage
    .set({ currentStage: stage, attempts: sql`${items.attempts} + 1`, updatedAt: sql`now()` })
// completeStage
    .set({
      state: STAGE_RESULT_STATE[stage],
      currentStage: NEXT_STAGE[stage],
      attempts: 0,
      lastError: null,
      updatedAt: sql`now()`,
    })
// recordFailure
    .set({ lastError: message.slice(0, 2000), updatedAt: sql`now()` })
// markFailed
    .set({ state: 'failed', currentStage: stage, updatedAt: sql`now()` })
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @benkyou/core test -- test/pipeline/updated-at.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/state.ts packages/core/test/pipeline/updated-at.int.test.ts
git commit -m "feat(core): bump items.updated_at on stage transitions"
```

### Task 5: Capture `sources.last_fetch_error` in ingest

**Files:**
- Modify: `packages/core/src/pipeline/ingest.ts`
- Test: `packages/core/test/pipeline/ingest-error.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/pipeline/ingest-error.int.test.ts` using MSW to make one feed fail (500) and another succeed (mirror the MSW + container pattern from `pipeline.int.test.ts`):

```ts
test('a fetch failure writes last_fetch_error and re-throws (retry-safe)', async () => {
  await expect(ingestSource(failSourceId)).rejects.toThrow();
  const r = await sql<{ last_fetch_error: string | null; last_polled_at: Date | null }[]>`
    SELECT last_fetch_error, last_polled_at FROM sources WHERE id = ${failSourceId}`;
  expect(r[0]!.last_fetch_error).toMatch(/500|fetch/i);
  expect(r[0]!.last_polled_at).toBeNull(); // unadvanced → still due
});

test('a successful fetch clears last_fetch_error and sets last_polled_at', async () => {
  await ingestSource(okSourceId);
  const r = await sql<{ last_fetch_error: string | null; last_polled_at: Date | null }[]>`
    SELECT last_fetch_error, last_polled_at FROM sources WHERE id = ${okSourceId}`;
  expect(r[0]!.last_fetch_error).toBeNull();
  expect(r[0]!.last_polled_at).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @benkyou/core test -- test/pipeline/ingest-error.int.test.ts`
Expected: FAIL — `last_fetch_error` stays NULL on failure (ingest throws before writing it).

- [ ] **Step 3: Wrap the fetch to record the error, then re-throw**

In `packages/core/src/pipeline/ingest.ts`, replace the straight `const raw = await adapter.fetchItems(...)` with a try/catch that persists the message but preserves the throw (keeps the existing retry / "still due" semantics):

```ts
  const adapter = getAdapter(source.type);
  let raw;
  try {
    // Intentional asymmetry with extract's degrade-on-error: a source we can't
    // fetch/parse throws, so the ingest job retries (lastPolledAt left unadvanced
    // → still due). We persist the message first so /sources can show it.
    raw = await adapter.fetchItems(source.config as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(sources).set({ lastFetchError: message.slice(0, 1000) }).where(eq(sources.id, source.id));
    throw err;
  }
```

Then update the success path at the end to clear the error alongside `lastPolledAt`:

```ts
  await db
    .update(sources)
    .set({ lastPolledAt: new Date(), lastFetchError: null })
    .where(eq(sources.id, source.id));
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @benkyou/core test -- test/pipeline/ingest-error.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/ingest.ts packages/core/test/pipeline/ingest-error.int.test.ts
git commit -m "feat(core): record and clear sources.last_fetch_error on ingest"
```

---

## Phase D — Core: sources CRUD, feed filter

### Task 6: Sources management module

**Files:**
- Create: `packages/core/src/sources/manage.ts`
- Modify: `packages/core/src/sources/index.ts`, `packages/core/src/setup/index.ts`
- Test: `packages/core/test/sources/manage.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/sources/manage.int.test.ts` (container + migrations boilerplate as in Task 2). Cover create→list-with-count, update, setEnabled, and both delete branches:

```ts
test('create then list shows the source with item count 0', async () => {
  const id = await manage.createSource({ name: 'Feed A', url: 'https://a/rss', weight: 1.5 });
  const row = (await manage.listSourcesWithStats()).find((s) => s.id === id)!;
  expect(row).toMatchObject({ name: 'Feed A', url: 'https://a/rss', enabled: true, itemCount: 0 });
});

test('item count aggregates from items', async () => {
  const id = await manage.createSource({ name: 'Feed B', url: 'https://b/rss', weight: 1 });
  await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state)
    VALUES (${id},'https://b/1','b1','t','article','done'),(${id},'https://b/2','b2','t','article','pending')`;
  const row = (await manage.listSourcesWithStats()).find((s) => s.id === id)!;
  expect(row.itemCount).toBe(2);
});

test('updateSource changes name/url/weight', async () => {
  const id = await manage.createSource({ name: 'Old', url: 'https://old/rss', weight: 1 });
  await manage.updateSource(id, { name: 'New', url: 'https://new/rss', weight: 2 });
  const row = (await manage.listSourcesWithStats()).find((s) => s.id === id)!;
  expect(row).toMatchObject({ name: 'New', url: 'https://new/rss' });
  expect(Number(row.weight)).toBe(2);
});

test('setSourceEnabled toggles', async () => {
  const id = await manage.createSource({ name: 'Tog', url: 'https://t/rss', weight: 1 });
  await manage.setSourceEnabled(id, false);
  expect((await manage.listSourcesWithStats()).find((s) => s.id === id)!.enabled).toBe(false);
});

test('deleteSource default keeps items (source_id → NULL)', async () => {
  const id = await manage.createSource({ name: 'Keep', url: 'https://k/rss', weight: 1 });
  await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state)
    VALUES (${id},'https://k/1','k1','t','article','done')`;
  await manage.deleteSource(id, { cascade: false });
  const orphan = await sql<{ source_id: string | null }[]>`SELECT source_id FROM items WHERE url_hash = 'k1'`;
  expect(orphan[0]!.source_id).toBeNull();
});

test('deleteSource cascade removes items too', async () => {
  const id = await manage.createSource({ name: 'Wipe', url: 'https://w/rss', weight: 1 });
  await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state)
    VALUES (${id},'https://w/1','w1','t','article','done')`;
  await manage.deleteSource(id, { cascade: true });
  const left = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM items WHERE url_hash = 'w1'`;
  expect(left[0]!.n).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @benkyou/core test -- test/sources/manage.int.test.ts`
Expected: FAIL — `Cannot find module '../../src/sources/manage.js'`.

- [ ] **Step 3: Implement `manage.ts`**

Create `packages/core/src/sources/manage.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import { getDbClient, items, sources } from '../db';
import { getBoss, registerQueues, enqueueIngest } from '../queue';

export interface SourceWithStats {
  id: string;
  type: string;
  name: string;
  url: string;
  weight: string | null;
  enabled: boolean;
  pollInterval: number | null;
  lastPolledAt: Date | null;
  lastFetchError: string | null;
  itemCount: number;
}

export async function listSourcesWithStats(): Promise<SourceWithStats[]> {
  const db = getDbClient();
  const rows = await db
    .select({
      id: sources.id,
      type: sources.type,
      name: sources.name,
      url: sql<string>`${sources.config} ->> 'url'`,
      weight: sources.weight,
      enabled: sources.enabled,
      pollInterval: sources.pollInterval,
      lastPolledAt: sources.lastPolledAt,
      lastFetchError: sources.lastFetchError,
      itemCount: sql<number>`(SELECT count(*)::int FROM ${items} WHERE ${items.sourceId} = ${sources.id})`,
    })
    .from(sources)
    .orderBy(sources.name);
  return rows.map((r) => ({ ...r, enabled: r.enabled ?? true }));
}

export async function createSource(input: { name: string; url: string; weight: number }): Promise<string> {
  const db = getDbClient();
  const rows = await db
    .insert(sources)
    .values({ type: 'rss', name: input.name, config: { url: input.url }, weight: String(input.weight) })
    .returning({ id: sources.id });
  const id = rows[0]?.id;
  if (!id) throw new Error('Failed to create source');
  return id;
}

export async function updateSource(
  id: string,
  input: { name: string; url: string; weight: number },
): Promise<void> {
  const db = getDbClient();
  await db
    .update(sources)
    .set({ name: input.name, config: { url: input.url }, weight: String(input.weight) })
    .where(eq(sources.id, id));
}

export async function setSourceEnabled(id: string, enabled: boolean): Promise<void> {
  const db = getDbClient();
  await db.update(sources).set({ enabled }).where(eq(sources.id, id));
}

export async function deleteSource(id: string, opts: { cascade: boolean }): Promise<void> {
  const db = getDbClient();
  // Default keeps content: items.source_id ON DELETE SET NULL (schema), orphans
  // fall back to adhoc_source_weight. Cascade: delete items first (their
  // embeddings cascade), then the source.
  if (opts.cascade) await db.delete(items).where(eq(items.sourceId, id));
  await db.delete(sources).where(eq(sources.id, id));
}

// Relocated from setup/index.ts (re-exported there for back-compat). Enqueues a
// one-off ingest for a source; idempotent registerQueues ensures the queue exists.
export async function triggerSourceFetch(sourceId: string): Promise<void> {
  const boss = await getBoss();
  await registerQueues(boss, 3);
  await enqueueIngest(boss, sourceId);
}
```

- [ ] **Step 4: Export from the sources barrel**

In `packages/core/src/sources/index.ts`, add:

```ts
export * from './manage';
```

- [ ] **Step 5: Relocate `triggerSourceFetch` out of setup, re-export it**

In `packages/core/src/setup/index.ts`, delete the local `triggerSourceFetch` function and remove the now-unused `import { enqueueIngest, getBoss, registerQueues } from '../queue';` (confirm `completeSetup` does not use them — it doesn't). Add a re-export so `apps/web/app/setup/actions.ts` keeps working unchanged:

```ts
export { triggerSourceFetch } from '../sources/manage';
```

- [ ] **Step 6: Run the sources test + the setup int test (no regression)**

Run: `pnpm --filter @benkyou/core test -- test/sources/manage.int.test.ts test/setup/setup.int.test.ts`
Expected: PASS for both.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sources packages/core/src/setup/index.ts packages/core/test/sources/manage.int.test.ts
git commit -m "feat(core): source CRUD module + relocate triggerSourceFetch"
```

### Task 7: `listFeed` source filter + feed item source id

**Files:**
- Modify: `packages/core/src/items/queries.ts`, `packages/core/src/items/index.ts`
- Test: `packages/core/test/items/feed-filter.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/items/feed-filter.int.test.ts` (container boilerplate as Task 2). Seed two sources (`SOURCE_A`, `SOURCE_B`), one `done` item each plus a `pending` item, then:

```ts
test('listFeed without sourceId returns all done items', async () => {
  const feed = await items.listFeed({ limit: 30, offset: 0 });
  expect(feed.map((f) => f.title).sort()).toEqual(['Done A', 'Done B']);
  expect(feed[0]!.sourceId).toBeTruthy();
});

test('listFeed with sourceId filters and still excludes non-done', async () => {
  const feed = await items.listFeed({ limit: 30, offset: 0, sourceId: SOURCE_A });
  expect(feed).toHaveLength(1);
  expect(feed[0]!.title).toBe('Done A');
});

test('getSourceName returns the name', async () => {
  expect(await items.getSourceName(SOURCE_A)).toBe('Feed A');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @benkyou/core test -- test/items/feed-filter.int.test.ts`
Expected: FAIL — `sourceId` is not an accepted option and `getSourceName` doesn't exist.

- [ ] **Step 3: Add `sourceId` to the query + `getSourceName`**

In `packages/core/src/items/queries.ts`, add `sourceId` to `FeedItem` and `FEED_COLUMNS`:

```ts
export interface FeedItem {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  category: string | null;
  contentType: string;
  publishedAt: Date | null;
  sourceId: string | null;
  sourceName: string | null;
  bookmarked: boolean;
}
```

```ts
const FEED_COLUMNS = {
  id: items.id,
  title: items.title,
  summary: items.summary,
  url: items.url,
  category: items.category,
  contentType: items.contentType,
  publishedAt: items.publishedAt,
  bookmarked: items.bookmarked,
  sourceId: items.sourceId,
  sourceName: sources.name,
};
```

Replace `listFeed` so the source filter is applied inside `WHERE` (alongside `state='done'`), and add `getSourceName`:

```ts
export async function listFeed(opts: {
  limit: number;
  offset: number;
  sourceId?: string;
}): Promise<FeedItem[]> {
  const db = getDbClient();
  const where = opts.sourceId
    ? and(eq(items.state, 'done'), eq(items.sourceId, opts.sourceId))
    : eq(items.state, 'done');
  const rows = await db
    .select(FEED_COLUMNS)
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(where)
    .orderBy(desc(sql`coalesce(${items.publishedAt}, ${items.ingestedAt})`))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map((r) => ({ ...r, bookmarked: r.bookmarked ?? false }));
}

export async function getSourceName(id: string): Promise<string | null> {
  const db = getDbClient();
  const rows = await db.select({ name: sources.name }).from(sources).where(eq(sources.id, id)).limit(1);
  return rows[0]?.name ?? null;
}
```

(`and` is already imported at the top of the file; `getItemForUser` keeps working — `FEED_COLUMNS` now also yields `sourceId`, additive to `ItemDetail`.)

- [ ] **Step 4: Export `getSourceName`**

In `packages/core/src/items/index.ts`:

```ts
export { listFeed, getItemForUser, getSourceName } from './queries';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @benkyou/core test -- test/items/feed-filter.int.test.ts test/items/queries.int.test.ts`
Expected: PASS for both (the existing `queries.int.test.ts` still passes — `sourceName` unchanged, `sourceId` added).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/items packages/core/test/items/feed-filter.int.test.ts
git commit -m "feat(core): listFeed source filter + getSourceName + FeedItem.sourceId"
```

---

## Phase E — Core: pipeline status & retry

### Task 8: `getPipelineStatus` (composed panel queries)

**Files:**
- Create: `packages/core/src/pipeline/status.ts`
- Modify: `packages/core/src/pipeline/index.ts`
- Test: `packages/core/test/pipeline/status.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/pipeline/status.int.test.ts` (container + migrations; also start pg-boss so `pgboss.job` exists — import `getBoss`/`registerQueues` and call them in `beforeAll`, `closeBoss` in `afterAll`). Seed a mix of states + `ai_usage` rows. Key assertions:

```ts
test('getStateCounts returns a count per present state', async () => {
  const map = Object.fromEntries((await status.getStateCounts()).map((c) => [c.state, c.count]));
  expect(map.done).toBe(1);
  expect(map.failed).toBe(1);
});

test('getOrphans flags in-flight items with no queued/active job', async () => {
  // ORPHAN_ID: state='extracted', current_stage='embed', NO pgboss.job for it
  expect((await status.getOrphans()).some((o) => o.id === ORPHAN_ID)).toBe(true);
});

test('getOrphans does NOT flag an in-flight item that has a created job', async () => {
  // IN_QUEUE_ID: enqueue an embed job via enqueueStage(boss,'embed',IN_QUEUE_ID) first
  expect((await status.getOrphans()).some((o) => o.id === IN_QUEUE_ID)).toBe(false);
});

test('getFailed returns last_error + stage', async () => {
  const failed = await status.getFailed(50);
  const row = failed.find((f) => f.id === FAILED_ID)!;
  expect(row.currentStage).toBe('embed');
  expect(row.lastError).toContain('boom');
});

test('getTokenSummary aggregates today by stage', async () => {
  const embed = (await status.getTokenSummary()).today.find((s) => s.stage === 'embed')!;
  expect(embed.totalTokens).toBe(42);
});

test('getDimensionDrift reports consistency', async () => {
  expect(await status.getDimensionDrift()).toMatchObject({ envDim: 1536, columnDim: 1536, settingsDim: 1536, consistent: true });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @benkyou/core test -- test/pipeline/status.int.test.ts`
Expected: FAIL — `Cannot find module '../../src/pipeline/status.js'`.

- [ ] **Step 3: Implement `status.ts`**

Create `packages/core/src/pipeline/status.ts`. Each function is independently exported (decision §2: query logic stays in core). Raw SQL is used only for `pgboss.job` (not a Drizzle table) and the `pg_attribute` dimension probe — both allowed by conventions (raw SQL for things Drizzle can't model).

```ts
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { getDbClient, items, sources, aiUsage } from '../db';
import { env } from '../config/env';

export interface StateCount {
  state: string;
  count: number;
}
export interface QueueHealthRow {
  stage: string;
  created: number;
  retry: number;
  active: number;
}
export interface PipelineItemRow {
  id: string;
  title: string;
  sourceName: string | null;
  currentStage: string | null;
  attempts: number;
  updatedAt: Date | null;
}
export interface FailedItemRow extends PipelineItemRow {
  lastError: string | null;
}
export interface StageTokens {
  stage: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
export interface TokenItemRow {
  id: string | null;
  title: string | null;
  totalTokens: number;
}
export interface DimensionDrift {
  envDim: number;
  columnDim: number | null;
  settingsDim: number | null;
  consistent: boolean;
}

const IN_FLIGHT = sql`${items.state} NOT IN ('done','failed')`;

export async function getStateCounts(): Promise<StateCount[]> {
  const db = getDbClient();
  return db
    .select({ state: items.state, count: sql<number>`count(*)::int` })
    .from(items)
    .groupBy(items.state);
}

// pgboss.job is created by pg-boss on first start. Guard so a fresh install (no
// schema yet) reports empty instead of throwing.
async function pgbossJobExists(): Promise<boolean> {
  const db = getDbClient();
  const r = await db.execute(sql`SELECT to_regclass('pgboss.job') AS t`);
  return (r as unknown as { t: string | null }[])[0]?.t != null;
}

export async function getQueueHealth(): Promise<QueueHealthRow[]> {
  if (!(await pgbossJobExists())) return [];
  const db = getDbClient();
  const r = await db.execute(sql`
    SELECT name AS stage,
           count(*) FILTER (WHERE state = 'created')::int AS created,
           count(*) FILTER (WHERE state = 'retry')::int   AS retry,
           count(*) FILTER (WHERE state = 'active')::int  AS active
    FROM pgboss.job
    WHERE name = ANY(ARRAY['extract','embed','score','dedup','summary','ingest'])
    GROUP BY name ORDER BY name`);
  return r as unknown as QueueHealthRow[];
}

// "Task lost": item is in-flight but no created/retry/active job carries its id.
// items.id is uuid; pgboss stores it as text in data->>'itemId'.
export async function getOrphans(): Promise<PipelineItemRow[]> {
  if (!(await pgbossJobExists())) return [];
  const db = getDbClient();
  const r = await db.execute(sql`
    SELECT i.id, i.title, s.name AS "sourceName", i.current_stage AS "currentStage",
           i.attempts, i.updated_at AS "updatedAt"
    FROM items i
    LEFT JOIN sources s ON s.id = i.source_id
    WHERE i.state NOT IN ('done','failed')
      AND NOT EXISTS (
        SELECT 1 FROM pgboss.job j
        WHERE j.data ->> 'itemId' = i.id::text
          AND j.state IN ('created','retry','active')
      )
    ORDER BY i.updated_at ASC NULLS FIRST
    LIMIT 50`);
  return r as unknown as PipelineItemRow[];
}

export async function getInFlight(limit = 50): Promise<PipelineItemRow[]> {
  const db = getDbClient();
  return db
    .select({
      id: items.id,
      title: items.title,
      sourceName: sources.name,
      currentStage: items.currentStage,
      attempts: items.attempts,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(IN_FLIGHT)
    .orderBy(sql`${items.updatedAt} ASC NULLS FIRST`)
    .limit(limit);
}

export async function getFailed(limit = 50): Promise<FailedItemRow[]> {
  const db = getDbClient();
  return db
    .select({
      id: items.id,
      title: items.title,
      sourceName: sources.name,
      currentStage: items.currentStage,
      attempts: items.attempts,
      updatedAt: items.updatedAt,
      lastError: items.lastError,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(items.state, 'failed'))
    .orderBy(desc(items.updatedAt))
    .limit(limit);
}

async function tokensByStage(sinceSql: ReturnType<typeof sql>): Promise<StageTokens[]> {
  const db = getDbClient();
  return db
    .select({
      stage: aiUsage.stage,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}),0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}),0)::int`,
      totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}),0)::int`,
    })
    .from(aiUsage)
    .where(sql`${aiUsage.createdAt} >= ${sinceSql}`)
    .groupBy(aiUsage.stage)
    .orderBy(aiUsage.stage);
}

export async function getTokenSummary(): Promise<{ today: StageTokens[]; week: StageTokens[] }> {
  const today = await tokensByStage(sql`date_trunc('day', now())`);
  const week = await tokensByStage(sql`now() - interval '7 days'`);
  return { today, week };
}

export async function getTokenTopItems(limit = 10): Promise<TokenItemRow[]> {
  const db = getDbClient();
  const r = await db.execute(sql`
    SELECT u.item_id AS id, i.title, sum(u.total_tokens)::int AS "totalTokens"
    FROM ai_usage u
    LEFT JOIN items i ON i.id = u.item_id
    WHERE u.created_at >= now() - interval '7 days' AND u.item_id IS NOT NULL
    GROUP BY u.item_id, i.title
    ORDER BY sum(u.total_tokens) DESC NULLS LAST
    LIMIT ${limit}`);
  return r as unknown as TokenItemRow[];
}

export async function getTokenNoItem(): Promise<number> {
  const db = getDbClient();
  const r = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsage.totalTokens}),0)::int` })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, sql`now() - interval '7 days'`), isNull(aiUsage.itemId)));
  return r[0]?.total ?? 0;
}

export async function getDimensionDrift(): Promise<DimensionDrift> {
  const db = getDbClient();
  const colRes = await db.execute(sql`
    SELECT atttypmod AS dim FROM pg_attribute
    WHERE attrelid = to_regclass('item_embeddings') AND attname = 'embedding'`);
  // pgvector stores vector(N) as atttypmod = N (no -4 offset like varchar).
  const columnDim = (colRes as unknown as { dim: number }[])[0]?.dim ?? null;
  const setRes = await db.execute(sql`SELECT embed_dim FROM user_settings WHERE id = 1`);
  const settingsDim = (setRes as unknown as { embed_dim: number }[])[0]?.embed_dim ?? null;
  const dims = [env.EMBED_DIM, columnDim, settingsDim].filter((d): d is number => typeof d === 'number');
  const consistent = dims.every((d) => d === dims[0]);
  return { envDim: env.EMBED_DIM, columnDim: columnDim != null ? Number(columnDim) : null, settingsDim, consistent };
}

export interface PipelineStatus {
  stateCounts: StateCount[];
  queueHealth: QueueHealthRow[];
  orphans: PipelineItemRow[];
  inFlight: PipelineItemRow[];
  failed: FailedItemRow[];
  tokens: { today: StageTokens[]; week: StageTokens[]; topItems: TokenItemRow[]; noItem: number };
  drift: DimensionDrift;
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const [stateCounts, queueHealth, orphans, inFlight, failed, tokenSummary, topItems, noItem, drift] =
    await Promise.all([
      getStateCounts(),
      getQueueHealth(),
      getOrphans(),
      getInFlight(50),
      getFailed(50),
      getTokenSummary(),
      getTokenTopItems(10),
      getTokenNoItem(),
      getDimensionDrift(),
    ]);
  return {
    stateCounts,
    queueHealth,
    orphans,
    inFlight,
    failed,
    tokens: { today: tokenSummary.today, week: tokenSummary.week, topItems, noItem },
    drift,
  };
}
```

- [ ] **Step 4: Export from the pipeline barrel**

In `packages/core/src/pipeline/index.ts`, add at the bottom:

```ts
export * from './status';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @benkyou/core test -- test/pipeline/status.int.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline/status.ts packages/core/src/pipeline/index.ts packages/core/test/pipeline/status.int.test.ts
git commit -m "feat(core): getPipelineStatus panel queries (state/queue/orphan/token/drift)"
```

### Task 9: `retryItem`

**Files:**
- Create: `packages/core/src/pipeline/retry.ts`
- Modify: `packages/core/src/pipeline/index.ts`
- Test: `packages/core/test/pipeline/retry.int.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/pipeline/retry.int.test.ts` (container + migrations + pg-boss). Assertions:

```ts
test('retryItem on a failed item resets to the stage pre-state and re-enqueues', async () => {
  // FAILED_ID: state='failed', current_stage='embed', attempts=3, last_error='boom'
  const res = await retry.retryItem(FAILED_ID);
  expect(res.requeued).toBe(true);
  const row = await sql<{ state: string; attempts: number; last_error: string | null }[]>`
    SELECT state, attempts, last_error FROM items WHERE id = ${FAILED_ID}`;
  expect(row[0]).toMatchObject({ state: 'extracted', attempts: 0, last_error: null }); // pre-state of embed
  const jobs = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pgboss.job WHERE name='embed' AND data->>'itemId'=${FAILED_ID} AND state IN ('created','retry','active')`;
  expect(jobs[0]!.n).toBe(1);
});

test('retryItem rejects a done item', async () => {
  const res = await retry.retryItem(DONE_ID);
  expect(res).toEqual({ requeued: false, reason: 'not-retryable' });
});

test('retryItem on an in-flight orphan re-enqueues the same way', async () => {
  // ORPHAN_ID: state='scored', current_stage='dedup', no job
  const res = await retry.retryItem(ORPHAN_ID);
  expect(res.requeued).toBe(true);
  const row = await sql<{ state: string }[]>`SELECT state FROM items WHERE id = ${ORPHAN_ID}`;
  expect(row[0]!.state).toBe('scored'); // pre-state of dedup
});

test('retryItem is idempotent under repeat calls', async () => {
  await retry.retryItem(ORPHAN_ID);
  expect((await retry.retryItem(ORPHAN_ID)).requeued).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @benkyou/core test -- test/pipeline/retry.int.test.ts`
Expected: FAIL — `Cannot find module '../../src/pipeline/retry.js'`.

- [ ] **Step 3: Implement `retry.ts`**

Create `packages/core/src/pipeline/retry.ts`:

```ts
import { eq } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { getBoss, registerQueues, enqueueStage } from '../queue';
import {
  PER_ITEM_STAGES,
  STAGE_REQUIRED_STATE,
  type ItemState,
  type PerItemStage,
} from './state';

export interface RetryResult {
  requeued: boolean;
  reason?: 'not-retryable' | 'no-stage';
}

function isPerItemStage(s: string | null): s is PerItemStage {
  return s != null && (PER_ITEM_STAGES as readonly string[]).includes(s);
}

/**
 * Recover a failed or orphaned (in-flight, no queued job) item: reset attempts,
 * restore state to current_stage's required pre-state, re-enqueue current_stage.
 * The same function powers both the "[retry]" (failed) and "[re-enqueue]"
 * (orphan) buttons. Re-running the stage is safe — runItemStage's state guard +
 * the queue's idempotent dedup absorb any double-enqueue (spec §7).
 */
export async function retryItem(itemId: string): Promise<RetryResult> {
  const db = getDbClient();
  const rows = await db
    .select({ state: items.state, currentStage: items.currentStage })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  const item = rows[0];
  if (!item) return { requeued: false, reason: 'not-retryable' };
  if (item.state === 'done') return { requeued: false, reason: 'not-retryable' };
  if (!isPerItemStage(item.currentStage)) return { requeued: false, reason: 'no-stage' };

  const stage = item.currentStage;
  const preState: ItemState = STAGE_REQUIRED_STATE[stage];
  await db
    .update(items)
    .set({ state: preState, attempts: 0, lastError: null, updatedAt: new Date() })
    .where(eq(items.id, itemId));

  const boss = await getBoss();
  await registerQueues(boss, 3);
  await enqueueStage(boss, stage, itemId);
  return { requeued: true };
}
```

- [ ] **Step 4: Export from the pipeline barrel**

In `packages/core/src/pipeline/index.ts`:

```ts
export * from './retry';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @benkyou/core test -- test/pipeline/retry.int.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline/retry.ts packages/core/src/pipeline/index.ts packages/core/test/pipeline/retry.int.test.ts
git commit -m "feat(core): retryItem for failed + orphaned items"
```

### Task 10: Core gate

- [ ] **Step 1: Full core suite + lint + typecheck**

Run: `pnpm --filter @benkyou/core test && pnpm --filter @benkyou/core lint && pnpm --filter @benkyou/core typecheck`
Expected: all PASS. Remove any unused imports flagged by lint (e.g. an unused symbol in `status.ts`).

- [ ] **Step 2: Commit (only if cleanup was needed)**

```bash
git add packages/core/src
git commit -m "chore(core): lint/typecheck cleanup for M1c"
```

---

## Phase F — Web: form-retention fix (regression-first)

### Task 11: Settings & setup forms preserve input on error

**Files:**
- Modify: `apps/web/app/(authed)/settings/actions.ts`, `SettingsForm.tsx`, `apps/web/app/setup/actions.ts`, `SetupForm.tsx`
- Test: `apps/web/app/(authed)/settings/actions.test.ts` (extend)

Pattern (spec §6.4): on validation/connectivity failure the action returns `{ error, values }`; the form uses `state.values?.<field> ?? <persisted/default>` as `defaultValue`. **Exceptions:** login/password forms do not repopulate (security); API-key fields *do* repopulate the submitted value (single-user, no leakage surface).

- [ ] **Step 1: Write the failing regression test**

In `apps/web/app/(authed)/settings/actions.test.ts`, add:

```ts
test('an invalid submit returns entered values for repopulation', async () => {
  mocks.testLLM.mockResolvedValueOnce({ ok: false, error: 'nope' });
  const { updateSettingsAction } = await import('./actions.js');
  const fd = settingsForm({ llmModel: 'my-model', embedModel: 'my-embed', llmApiKey: 'typed-key' });
  const result = await updateSettingsAction({}, fd);
  expect(result.error).toBe('llmFailed');
  expect(result.values).toMatchObject({
    llmProvider: 'openai',
    llmModel: 'my-model',
    embedModel: 'my-embed',
    llmApiKey: 'typed-key', // single-user: ok to echo
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @benkyou/web test -- settings/actions.test.ts`
Expected: FAIL — `SettingsState` has no `values` of this shape (currently `values?: { got; want }`).

- [ ] **Step 3: Widen `SettingsState` and return field values on every error path**

In `apps/web/app/(authed)/settings/actions.ts`, replace the `SettingsState` interface (renaming the dim payload to `dim` to free up `values`):

```ts
export interface FormValues {
  locale: string;
  llmProvider: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmCheapModel: string;
  embedProvider: string;
  embedBaseUrl: string;
  embedApiKey: string;
  embedModel: string;
  embedRequestDimensions: boolean;
  interestTags: string;
}

export interface SettingsState {
  ok?: boolean;
  error?: string;
  detail?: string;
  dim?: { got: number; want: number };
  values?: FormValues;
}
```

At the top of `updateSettingsAction` (after `requireAuth()`), build the snapshot and attach `values` to every error return:

```ts
  const values: FormValues = {
    locale: String(fd.get('locale') ?? 'zh'),
    llmProvider: String(fd.get('llmProvider') ?? ''),
    llmBaseUrl: String(fd.get('llmBaseUrl') ?? ''),
    llmApiKey: String(fd.get('llmApiKey') ?? ''),
    llmModel: String(fd.get('llmModel') ?? ''),
    llmCheapModel: String(fd.get('llmCheapModel') ?? ''),
    embedProvider: String(fd.get('embedProvider') ?? ''),
    embedBaseUrl: String(fd.get('embedBaseUrl') ?? ''),
    embedApiKey: String(fd.get('embedApiKey') ?? ''),
    embedModel: String(fd.get('embedModel') ?? ''),
    embedRequestDimensions: fd.get('embedRequestDimensions') === 'on',
    interestTags: String(fd.get('interestTags') ?? ''),
  };
```

```ts
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'invalid', values };
  ...
  if (!llmTest.ok) return { error: 'llmFailed', detail: llmTest.error, values };
  ...
  if (!embTest.ok) return { error: 'embedFailed', detail: embTest.error, values };
  if (embTest.dim !== env.EMBED_DIM) {
    return { error: 'dimMismatch', dim: { got: embTest.dim ?? 0, want: env.EMBED_DIM }, values };
  }
```

(Success path unchanged: `return { ok: true }`.)

- [ ] **Step 4: Update `SettingsForm.tsx` to read from `state.values`**

In `apps/web/app/(authed)/settings/SettingsForm.tsx`, change the dim reference and seed every field from `state.values`:

```tsx
  const v = state.values;
  const errorText =
    state.error === 'dimMismatch'
      ? t('dimMismatch', { got: state.dim?.got ?? 0, want: state.dim?.want ?? 0 })
      : state.error
        ? t(state.error as 'llmFailed', { error: state.detail ?? '' })
        : null;
```

Then for each input use `defaultValue={v?.<field> ?? settings.<field> ?? ''}`; for the locale `<select>` `defaultValue={v?.locale ?? settings.locale}`; for the toggle `defaultChecked={v?.embedRequestDimensions ?? settings.embedRequestDimensions}`; for the two API-key password fields `defaultValue={v?.llmApiKey ?? ''}` / `defaultValue={v?.embedApiKey ?? ''}` (echo on error, blank otherwise — the placeholder still signals "configured").

- [ ] **Step 5: Apply the identical pattern to setup**

In `apps/web/app/setup/actions.ts`: add the same `FormValues`-style snapshot (setup also has `sourceName`/`sourceUrl` — include them), rename the dim payload to `dim`, attach `values` to each non-redirect error return. In `apps/web/app/setup/SetupForm.tsx`, add `defaultValue={state.values?.<field> ?? <default>}` to every input and `defaultChecked` to the toggle. Leave redirect paths untouched.

- [ ] **Step 6: Run the web unit tests**

Run: `pnpm --filter @benkyou/web test`
Expected: PASS — including the new retention test and existing `SettingsForm.test.ts`/`actions.test.ts`. If `SettingsForm.test.ts` asserts the old `state.values` dim shape, update it to `state.dim`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(authed\)/settings apps/web/app/setup
git commit -m "fix(web): preserve form input on setup/settings validation errors"
```

---

## Phase G — Web: AutoRefresh, sources page, panel, feed wiring

### Task 12: `<AutoRefresh>` client component

**Files:**
- Create: `apps/web/components/AutoRefresh.tsx`

- [ ] **Step 1: Implement the component**

Create `apps/web/components/AutoRefresh.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const t = useTranslations('jobs');
  const [paused, setPaused] = useState(false);
  const [last, setLast] = useState<Date | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const tick = (): void => {
      // Only refresh when the tab is visible (spec §6.1). On transient failure the
      // refresh simply no-ops this cycle; session expiry redirects via (authed).
      if (pausedRef.current || document.visibilityState !== 'visible') return;
      router.refresh();
      setLast(new Date());
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-600"
      >
        {paused ? t('resume') : t('pause')}
      </button>
      <span>{last ? t('lastRefresh', { time: last.toLocaleTimeString() }) : t('autoRefresh')}</span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @benkyou/web typecheck`
Expected: PASS (message keys are validated by `check:i18n` in Task 16, not by tsc).

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/AutoRefresh.tsx
git commit -m "feat(web): visibility-gated AutoRefresh component"
```

### Task 13: `/sources` page (list + CRUD + fetch-now)

**Files:**
- Create: `apps/web/app/(authed)/sources/page.tsx`, `actions.ts`, `SourceList.tsx`, `AddSourceForm.tsx`, `EditSourceForm.tsx`, `DeleteSourceForm.tsx`
- Modify: `apps/web/app/(authed)/layout.tsx`

- [ ] **Step 1: Server actions**

Create `apps/web/app/(authed)/sources/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  createSource,
  updateSource,
  deleteSource,
  setSourceEnabled,
  triggerSourceFetch,
} from '@benkyou/core/sources';
import { requireAuth } from '@/lib/auth';

export interface SourceFormState {
  error?: string;
  values?: { name: string; url: string; weight: string };
}

const SourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  weight: z.coerce.number().positive(),
});

export async function addSourceAction(_p: SourceFormState, fd: FormData): Promise<SourceFormState> {
  await requireAuth();
  const values = {
    name: String(fd.get('name') ?? ''),
    url: String(fd.get('url') ?? ''),
    weight: String(fd.get('weight') ?? '1'),
  };
  const parsed = SourceSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'invalid', values };
  const id = await createSource(parsed.data);
  await triggerSourceFetch(id); // auto-fetch on create (spec §6.2)
  revalidatePath('/sources');
  return {};
}

export async function editSourceAction(_p: SourceFormState, fd: FormData): Promise<SourceFormState> {
  await requireAuth();
  const id = String(fd.get('id') ?? '');
  const values = {
    name: String(fd.get('name') ?? ''),
    url: String(fd.get('url') ?? ''),
    weight: String(fd.get('weight') ?? '1'),
  };
  const parsed = SourceSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'invalid', values };
  await updateSource(id, parsed.data);
  revalidatePath('/sources');
  return {};
}

export async function toggleSourceAction(fd: FormData): Promise<void> {
  await requireAuth();
  await setSourceEnabled(String(fd.get('id')), fd.get('enabled') === 'true');
  revalidatePath('/sources');
}

export async function fetchSourceNowAction(fd: FormData): Promise<void> {
  await requireAuth();
  // Paused sources allow manual fetch (spec §6.2): pause only stops auto-polling.
  await triggerSourceFetch(String(fd.get('id')));
  revalidatePath('/sources');
}

export async function deleteSourceAction(fd: FormData): Promise<void> {
  await requireAuth();
  await deleteSource(String(fd.get('id')), { cascade: fd.get('cascade') === 'on' });
  revalidatePath('/sources');
}
```

- [ ] **Step 2: Page (RSC)**

Create `apps/web/app/(authed)/sources/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { listSourcesWithStats } from '@benkyou/core/sources';
import { AutoRefresh } from '@/components/AutoRefresh';
import { SourceList } from './SourceList';
import { AddSourceForm } from './AddSourceForm';

export default async function SourcesPage() {
  const t = await getTranslations('sources');
  const sources = await listSourcesWithStats();
  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <AutoRefresh />
      </div>
      <AddSourceForm />
      <SourceList sources={sources} />
    </main>
  );
}
```

- [ ] **Step 3: `AddSourceForm` / `EditSourceForm` (client, `useActionState`)**

Create `apps/web/app/(authed)/sources/AddSourceForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { addSourceAction, type SourceFormState } from './actions';

const field = 'rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800';

export function AddSourceForm() {
  const t = useTranslations('sources');
  const [state, action, pending] = useActionState<SourceFormState, FormData>(addSourceAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded border border-slate-200 p-3 dark:border-slate-700">
      <input name="name" required placeholder={t('namePlaceholder')} defaultValue={state.values?.name ?? ''} className={field} />
      <input name="url" type="url" required placeholder={t('urlPlaceholder')} defaultValue={state.values?.url ?? ''} className={field} />
      <input name="weight" type="number" step="0.1" min="0.1" placeholder={t('weightPlaceholder')} defaultValue={state.values?.weight ?? '1'} className={`${field} w-24`} />
      <button type="submit" disabled={pending} className="rounded bg-slate-900 p-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
        {t('add')}
      </button>
      {state.error ? <p className="w-full text-sm text-red-600">{t('invalid')}</p> : null}
    </form>
  );
}
```

Create `apps/web/app/(authed)/sources/EditSourceForm.tsx` — same fields plus a hidden `id`, calling `editSourceAction`, seeded from a `defaults` prop:

```tsx
'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { editSourceAction, type SourceFormState } from './actions';

const field = 'rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800';

export function EditSourceForm({
  id,
  defaults,
}: {
  id: string;
  defaults: { name: string; url: string; weight: string };
}) {
  const t = useTranslations('sources');
  const [state, action, pending] = useActionState<SourceFormState, FormData>(editSourceAction, {});
  const v = state.values;
  return (
    <form action={action} className="mt-1 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="name" required defaultValue={v?.name ?? defaults.name} className={field} />
      <input name="url" type="url" required defaultValue={v?.url ?? defaults.url} className={field} />
      <input name="weight" type="number" step="0.1" min="0.1" defaultValue={v?.weight ?? defaults.weight} className={`${field} w-24`} />
      <button type="submit" disabled={pending} className="rounded border border-slate-300 px-2 py-1 dark:border-slate-600">
        {t('save')}
      </button>
      {state.error ? <p className="w-full text-sm text-red-600">{t('invalid')}</p> : null}
    </form>
  );
}
```

- [ ] **Step 4: `SourceList` + `DeleteSourceForm`**

Create `apps/web/app/(authed)/sources/SourceList.tsx`:

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { SourceWithStats } from '@benkyou/core/sources';
import { toggleSourceAction, fetchSourceNowAction } from './actions';
import { EditSourceForm } from './EditSourceForm';
import { DeleteSourceForm } from './DeleteSourceForm';

export async function SourceList({ sources }: { sources: SourceWithStats[] }) {
  const t = await getTranslations('sources');
  if (sources.length === 0) return <p className="text-slate-500">{t('empty')}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {sources.map((s) => (
        <li key={s.id} className="rounded border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded bg-slate-100 px-1.5 text-xs dark:bg-slate-800">{s.type}</span>
            <span className="font-semibold">{s.name}</span>
            <a href={s.url} className="max-w-xs truncate text-slate-500" target="_blank" rel="noreferrer">{s.url}</a>
            <span className="text-slate-500">{t('weight')}: {s.weight}</span>
            <form action={toggleSourceAction}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="enabled" value={String(!s.enabled)} />
              <button type="submit" className="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-600">
                {s.enabled ? t('pause') : t('enable')}
              </button>
            </form>
            <span className="text-slate-500">
              {s.lastPolledAt ? t('polledAt', { time: new Date(s.lastPolledAt).toLocaleString() }) : t('neverPolled')}
            </span>
            {s.lastFetchError ? (
              <details className="text-red-600"><summary>✗ {t('fetchError')}</summary><pre className="whitespace-pre-wrap text-xs">{s.lastFetchError}</pre></details>
            ) : (
              <span className="text-green-600">✓</span>
            )}
            <Link href={`/?source=${s.id}`} className="text-slate-500 underline">
              {t('itemCount', { count: s.itemCount })}
            </Link>
            <form action={fetchSourceNowAction} className="ml-auto">
              <input type="hidden" name="id" value={s.id} />
              <button type="submit" className="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-600">{t('fetchNow')}</button>
            </form>
            <DeleteSourceForm id={s.id} />
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-slate-500">{t('edit')}</summary>
            <EditSourceForm id={s.id} defaults={{ name: s.name, url: s.url, weight: s.weight ?? '1' }} />
          </details>
        </li>
      ))}
    </ul>
  );
}
```

Create `apps/web/app/(authed)/sources/DeleteSourceForm.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { deleteSourceAction } from './actions';

export function DeleteSourceForm({ id }: { id: string }) {
  const t = useTranslations('sources');
  return (
    <details>
      <summary className="cursor-pointer text-red-600">{t('delete')}</summary>
      <form action={deleteSourceAction} className="mt-1 flex flex-col gap-1 text-xs">
        <input type="hidden" name="id" value={id} />
        <label className="flex items-center gap-1">
          <input type="checkbox" name="cascade" /> {t('deleteWithContent')}
        </label>
        <button type="submit" className="rounded bg-red-600 px-2 py-0.5 text-white">{t('confirmDelete')}</button>
      </form>
    </details>
  );
}
```

- [ ] **Step 5: Add nav links**

In `apps/web/app/(authed)/layout.tsx`, add to the `<nav>` (after the existing links):

```tsx
          <Link href="/sources">{t('sources')}</Link>
          <Link href="/admin/jobs">{t('jobs')}</Link>
```

- [ ] **Step 6: Typecheck + manual smoke**

Run: `pnpm --filter @benkyou/web typecheck`
Expected: PASS.
Then `pnpm --filter @benkyou/web dev` and verify `/sources`: add a source, toggle pause, fetch-now, edit, delete (both branches). Don't claim "looks good" without running.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(authed\)/sources apps/web/app/\(authed\)/layout.tsx
git commit -m "feat(web): /sources management page (CRUD + status + fetch-now)"
```

### Task 14: `/admin/jobs` pipeline panel

**Files:**
- Create: `apps/web/app/(authed)/admin/jobs/page.tsx`, `actions.ts`, `RetryButton.tsx`

- [ ] **Step 1: Retry server action**

Create `apps/web/app/(authed)/admin/jobs/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { retryItem } from '@benkyou/core/pipeline';
import { requireAuth } from '@/lib/auth';

export async function retryItemAction(fd: FormData): Promise<void> {
  await requireAuth();
  await retryItem(String(fd.get('itemId')));
  revalidatePath('/admin/jobs');
}
```

- [ ] **Step 2: `RetryButton` (client)**

Create `apps/web/app/(authed)/admin/jobs/RetryButton.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useFormStatus } from 'react-dom';
import { retryItemAction } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  const t = useTranslations('jobs');
  return (
    <button type="submit" disabled={pending} className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-50 dark:border-slate-600">
      {t('retry')}
    </button>
  );
}

export function RetryButton({ itemId }: { itemId: string }) {
  return (
    <form action={retryItemAction}>
      <input type="hidden" name="itemId" value={itemId} />
      <Submit />
    </form>
  );
}
```

- [ ] **Step 3: Panel page (RSC, six sections)**

Create `apps/web/app/(authed)/admin/jobs/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { getPipelineStatus } from '@benkyou/core/pipeline';
import { AutoRefresh } from '@/components/AutoRefresh';
import { RetryButton } from './RetryButton';

const STALL_MS = 30 * 60 * 1000;

function stalled(updatedAt: Date | null): boolean {
  return updatedAt != null && Date.now() - new Date(updatedAt).getTime() > STALL_MS;
}

export default async function JobsPage() {
  const t = await getTranslations('jobs');
  const s = await getPipelineStatus();
  const stateMap = Object.fromEntries(s.stateCounts.map((c) => [c.state, c.count]));
  const STATES = ['pending', 'extracted', 'embedded', 'scored', 'dedup_done', 'done', 'failed'] as const;

  return (
    <main className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <AutoRefresh />
      </div>

      {/* 1. State distribution */}
      <section>
        <h2 className="mb-2 font-semibold">{t('stateDistribution')}</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {STATES.map((st) => (
            <a key={st} href={st === 'failed' ? '#failed' : '#inflight'} className="rounded border border-slate-200 px-2 py-1 dark:border-slate-700">
              {t(`state.${st}` as 'state.done')}: <strong>{stateMap[st] ?? 0}</strong>
            </a>
          ))}
        </div>
      </section>

      {/* 2. Queue health + orphans */}
      <section>
        <h2 className="mb-2 font-semibold">{t('queueHealth')}</h2>
        <table className="w-full text-left text-sm">
          <thead><tr className="text-slate-500"><th>{t('stage')}</th><th>created</th><th>retry</th><th>active</th></tr></thead>
          <tbody>
            {s.queueHealth.map((q) => (
              <tr key={q.stage}><td>{q.stage}</td><td>{q.created}</td><td>{q.retry}</td><td>{q.active}</td></tr>
            ))}
          </tbody>
        </table>
        {s.orphans.length > 0 ? (
          <div className="mt-2">
            <p className="text-sm font-semibold text-red-600">{t('orphansTitle')}</p>
            <ul className="flex flex-col gap-1 text-sm">
              {s.orphans.map((o) => (
                <li key={o.id} className="flex items-center gap-2">
                  <span className="text-red-600">{t('taskLost')}</span>
                  <span className="truncate">{o.title}</span>
                  <span className="text-slate-500">{o.currentStage}</span>
                  <RetryButton itemId={o.id} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* 3. In-flight */}
      <section id="inflight">
        <h2 className="mb-2 font-semibold">{t('inFlight')}</h2>
        {s.inFlight.length === 0 ? <p className="text-slate-500">{t('none')}</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {s.inFlight.map((i) => (
              <li key={i.id} className={`flex items-center gap-2 ${stalled(i.updatedAt) ? 'text-amber-600' : ''}`}>
                <span className="truncate">{i.title}</span>
                <span className="text-slate-500">{i.sourceName}</span>
                <span>{i.currentStage}</span>
                <span className="text-slate-500">{t('attempts', { n: i.attempts })}</span>
                {stalled(i.updatedAt) ? <span>{t('stalled')}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Failed */}
      <section id="failed">
        <h2 className="mb-2 font-semibold">{t('failed')}</h2>
        {s.failed.length === 0 ? <p className="text-slate-500">{t('none')}</p> : (
          <ul className="flex flex-col gap-2 text-sm">
            {s.failed.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 rounded border border-slate-200 p-2 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{f.title}</span>
                  <span className="text-slate-500">{f.sourceName}</span>
                  <span>{f.currentStage}</span>
                  <span className="text-slate-500">{t('attempts', { n: f.attempts })}</span>
                  <RetryButton itemId={f.id} />
                </div>
                {f.lastError ? <details><summary className="text-red-600">{t('lastError')}</summary><pre className="whitespace-pre-wrap text-xs">{f.lastError}</pre></details> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 5. Token consumption */}
      <section>
        <h2 className="mb-2 font-semibold">{t('tokens')}</h2>
        <p className="text-sm text-slate-500">{t('today')}</p>
        <TokenTable rows={s.tokens.today} t={t} />
        <p className="mt-2 text-sm text-slate-500">{t('week')}</p>
        <TokenTable rows={s.tokens.week} t={t} />
        <p className="mt-2 text-sm text-slate-500">{t('topItems')}</p>
        <ul className="text-sm">
          {s.tokens.topItems.map((it) => (
            <li key={it.id ?? 'none'}>{it.title ?? t('untitled')}: {it.totalTokens}</li>
          ))}
          <li className="text-slate-500">{t('noItemTokens', { n: s.tokens.noItem })}</li>
        </ul>
      </section>

      {/* 6. Dimension drift */}
      <section>
        <h2 className="mb-2 font-semibold">{t('drift')}</h2>
        {s.drift.consistent ? (
          <p className="text-sm text-green-600">{t('driftOk', { dim: s.drift.envDim })}</p>
        ) : (
          <p className="text-sm text-red-600">
            {t('driftWarn', { env: s.drift.envDim, col: s.drift.columnDim ?? 0, set: s.drift.settingsDim ?? 0 })}
          </p>
        )}
      </section>
    </main>
  );
}

function TokenTable({
  rows,
  t,
}: {
  rows: { stage: string; calls: number; inputTokens: number; outputTokens: number; totalTokens: number }[];
  t: (k: string) => string;
}) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{t('none')}</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead><tr className="text-slate-500"><th>{t('stage')}</th><th>{t('calls')}</th><th>in</th><th>out</th><th>total</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.stage}><td>{r.stage}</td><td>{r.calls}</td><td>{r.inputTokens}</td><td>{r.outputTokens}</td><td>{r.totalTokens}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Typecheck + manual smoke**

Run: `pnpm --filter @benkyou/web typecheck`
Expected: PASS.
Manually verify `/admin/jobs` renders; construct a failed item in the dev DB and confirm the retry button restores it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(authed\)/admin
git commit -m "feat(web): /admin/jobs pipeline panel + retry"
```

### Task 15: Feed source chip + `?source=` filter

**Files:**
- Create: `apps/web/components/SourceBadge.tsx`
- Modify: `apps/web/components/ItemCard.tsx`, `apps/web/app/(authed)/page.tsx`

- [ ] **Step 1: `SourceBadge`**

Create `apps/web/components/SourceBadge.tsx`:

```tsx
import Link from 'next/link';

export function SourceBadge({ id, name }: { id: string | null; name: string | null }) {
  if (!name) return null;
  if (!id) return <span className="text-slate-500">{name}</span>;
  return (
    <Link
      href={`/?source=${id}`}
      className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {name}
    </Link>
  );
}
```

- [ ] **Step 2: Use it in `ItemCard`**

In `apps/web/components/ItemCard.tsx`, import `SourceBadge` and replace the source `<span>` (`{item.sourceName ? <span>{item.sourceName}</span> : null}`) with:

```tsx
        <SourceBadge id={item.sourceId} name={item.sourceName} />
```

(`item.sourceId` now exists on `FeedItem` from Task 7.)

- [ ] **Step 3: Feed page accepts `?source=`**

Rewrite `apps/web/app/(authed)/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { listFeed, getSourceName } from '@benkyou/core/items';
import { ItemCard } from '@/components/ItemCard';

const PAGE_SIZE = 30;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; source?: string }>;
}) {
  const t = await getTranslations('feed');
  const { page, source } = await searchParams;
  const pageNum = Math.max(1, Number(page ?? '1') || 1);
  const feed = await listFeed({ limit: PAGE_SIZE, offset: (pageNum - 1) * PAGE_SIZE, sourceId: source });
  const sourceName = source ? await getSourceName(source) : null;
  const qs = (p: number): string => (source ? `/?source=${source}&page=${p}` : `/?page=${p}`);

  return (
    <main>
      <h1 className="mb-4 text-xl font-bold">{t('title')}</h1>
      {source ? (
        <div className="mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <span>{t('filteredBy', { name: sourceName ?? source, count: feed.length })}</span>
          <a href="/" className="underline">✕ {t('clearFilter')}</a>
        </div>
      ) : null}
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
        {pageNum > 1 ? <a href={qs(pageNum - 1)}>← {t('prev')}</a> : <span />}
        {feed.length === PAGE_SIZE ? <a href={qs(pageNum + 1)}>{t('next')} →</a> : <span />}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @benkyou/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/SourceBadge.tsx apps/web/components/ItemCard.tsx apps/web/app/\(authed\)/page.tsx
git commit -m "feat(web): clickable source chip + per-source feed filter"
```

### Task 16: i18n keys (zh + en)

**Files:**
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`

- [ ] **Step 1: Add keys to both locale files**

Extend `nav` and `feed`, add `sources` and `jobs` namespaces. **`zh.json`:**

```jsonc
// nav: add "sources": "源管理", "jobs": "Pipeline"
// feed: add "filteredBy": "来源：{name} · {count} 条", "clearFilter": "清除"
"sources": {
  "title": "源管理",
  "empty": "还没有源。",
  "namePlaceholder": "名称",
  "urlPlaceholder": "RSS 地址",
  "weightPlaceholder": "权重",
  "add": "添加",
  "save": "保存",
  "invalid": "请检查输入（名称、合法 URL、正权重）",
  "weight": "权重",
  "pause": "暂停",
  "enable": "启用",
  "polledAt": "上次拉取 {time}",
  "neverPolled": "尚未拉取",
  "fetchError": "拉取失败",
  "itemCount": "{count} 条",
  "fetchNow": "立即拉取",
  "edit": "编辑",
  "delete": "删除",
  "deleteWithContent": "连同该源全部内容一并删除",
  "confirmDelete": "确认删除"
},
"jobs": {
  "title": "Pipeline",
  "pause": "暂停",
  "resume": "继续",
  "autoRefresh": "自动刷新中",
  "lastRefresh": "上次刷新 {time}",
  "stateDistribution": "状态分布",
  "state": {
    "pending": "待处理", "extracted": "已提取", "embedded": "已向量化",
    "scored": "已评分", "dedup_done": "已去重", "done": "完成", "failed": "失败"
  },
  "queueHealth": "队列健康",
  "stage": "阶段",
  "orphansTitle": "孤儿任务",
  "taskLost": "任务丢失",
  "inFlight": "处理中",
  "none": "（无）",
  "attempts": "尝试 {n} 次",
  "stalled": "疑似卡死",
  "failed": "失败明细",
  "lastError": "错误信息",
  "retry": "重试",
  "tokens": "Token 消耗",
  "today": "今日",
  "week": "近 7 日",
  "calls": "次数",
  "topItems": "近 7 日 Top 10",
  "untitled": "（无标题）",
  "noItemTokens": "无 item 关联：{n}",
  "drift": "维度漂移",
  "driftOk": "✓ 维度一致（{dim}）",
  "driftWarn": "⚠ 维度不一致：env={env} / 列={col} / 设置={set}。列维度为准（迁移时冻结），embed 阶段会失败直到模型输出维度等于列维度。"
}
```

Add the matching English values to **`en.json`** (same key paths; e.g. `nav.sources`="Sources", `nav.jobs`="Pipeline", `feed.filteredBy`="Source: {name} · {count} items", `feed.clearFilter`="Clear", `sources.add`="Add", `sources.delete`="Delete", `jobs.state.done`="Done", `jobs.retry`="Retry", `jobs.lastError`="Last error", `jobs.driftWarn`="⚠ Dimension mismatch: env={env} / column={col} / settings={set}. The column is authoritative (frozen at migration); embed fails until model output dim == column dim.").

- [ ] **Step 2: Run the i18n check**

Run: `pnpm check:i18n`
Expected: PASS — zh and en key sets match.

- [ ] **Step 3: Commit**

```bash
git add apps/web/messages
git commit -m "feat(web): i18n strings for sources + jobs panel"
```

---

## Phase H — e2e & docs

> **Design note on e2e flow 1 (read before Task 17).** Spec §8 flow 1 wants "add source → auto-fetch → panel shows it reach done → feed shows it". The Playwright harness starts the Next dev server but **no worker**, so the pipeline only advances when something drains the queue. Chosen mechanism: the test drives `GET /api/cron/work?max=50` (the existing serverless trigger; `processBatch` runs in-process against the same DB) until the item is `done`. This needs two harness additions: (a) a mock RSS server so the feed fetch succeeds offline; (b) the existing provider mock must answer the `score` stage's `generateObject` with schema-valid JSON. **The real guarantee of pipeline correctness is the core Testcontainers suite (Tasks 3–9)**; this e2e validates UI wiring end-to-end. If the structured-output mock proves brittle (e.g. the provider uses tool-mode rather than `response_format`), fall back to seeding a `done` item attributed to the added source and assert panel/feed wiring without the live `score` stage — note that fallback in the test file rather than letting it flake.

### Task 17: e2e harness — mock RSS + structured-output provider mock

**Files:**
- Create: `apps/web/e2e/rss-mock-server.ts`
- Modify: `apps/web/e2e/provider-mock-server.ts`, `apps/web/e2e/global-setup.ts`, `apps/web/playwright.config.ts`

- [ ] **Step 1: Mock RSS server**

Create `apps/web/e2e/rss-mock-server.ts`:

```ts
import { createServer } from 'node:http';

const PORT = Number(process.env.RSS_MOCK_PORT ?? 4699);
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel><title>E2E Feed</title>
    <item>
      <title>E2E Pipeline Item</title>
      <link>http://localhost:${PORT}/article</link>
      <guid>e2e-1</guid>
      <pubDate>Wed, 10 Jun 2026 10:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>${'Substantive e2e body content. '.repeat(60)}</p>]]></content:encoded>
    </item>
  </channel></rss>`;

createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/health') { res.writeHead(200).end('ok'); return; }
  res.writeHead(200, { 'content-type': 'application/rss+xml' }).end(FEED);
}).listen(PORT, () => console.log(`[rss-mock] listening on http://localhost:${PORT}`));
```

- [ ] **Step 2: Teach the provider mock to answer structured generation**

In `apps/web/e2e/provider-mock-server.ts`, replace the `/chat/completions` branch body so a structured request (`body.response_format` present, used by `generateObject`) returns JSON content matching `scoreSchema`:

```ts
    if (path.endsWith('/chat/completions')) {
      const structured = body.response_format != null;
      const content = structured
        ? JSON.stringify({ topic_tags: ['e2e'], topic_score: 0.5, category: 'news' })
        : 'ok';
      res.writeHead(200);
      res.end(JSON.stringify({
        id: 'chatcmpl-mock', object: 'chat.completion', created: Math.floor(Date.now() / 1000),
        model: typeof body.model === 'string' ? body.model : 'mock-llm',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
      return;
    }
```

(Keep the `/embeddings` branch — it already truncates to `body.dimensions` and returns `usage`.)

- [ ] **Step 3: Seed the e2e DB with the mock provider config**

In `apps/web/e2e/global-setup.ts`, change the seeded `user_settings` insert so the pipeline's AI calls hit the provider mock (currently `openai`/`gpt-x`/`emb-x` would make real network calls). Point at the mock and enable request-dimensions (mock is 3072-native, truncates to 1536):

```ts
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, embed_request_dimensions, locale,
       llm_provider, llm_base_url, llm_model, llm_cheap_model,
       embed_provider, embed_base_url, embed_model)
      VALUES (1, ${passwordHash}, 1536, true, 'en',
        'openai-compatible', 'http://localhost:4599/v1', 'mock-llm', 'mock-llm',
        'openai-compatible', 'http://localhost:4599/v1', 'mock-embed')`;
```

(Golden-path stays valid — it reads a cached deep summary, no live LLM; embedding-dimensions fills its own provider in the form. Confirm both still pass in Task 18.)

- [ ] **Step 4: Register the mock-RSS webServer**

In `apps/web/playwright.config.ts`, add a third `webServer` entry:

```ts
    {
      command: 'pnpm exec tsx e2e/rss-mock-server.ts',
      url: 'http://localhost:4699/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { RSS_MOCK_PORT: '4699' },
    },
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/rss-mock-server.ts apps/web/e2e/provider-mock-server.ts apps/web/e2e/global-setup.ts apps/web/playwright.config.ts
git commit -m "test(web/e2e): mock RSS server + structured-output provider mock"
```

### Task 18: e2e specs (three flows)

**Files:**
- Create: `apps/web/e2e/sources.spec.ts`, `apps/web/e2e/jobs-retry.spec.ts`, `apps/web/e2e/form-retention.spec.ts`

- [ ] **Step 1: Source golden-path spec**

Create `apps/web/e2e/sources.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

const RSS_URL = 'http://localhost:4699/feed.xml';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="password"]', 'e2e-password');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/login/);
}

async function drainUntilDone(page: Page): Promise<void> {
  // The dev server has no worker; drive the serverless trigger in-process.
  for (let i = 0; i < 12; i++) {
    const res = await page.request.get('/api/cron/work?max=50');
    const body = await res.json();
    if (body.processed === 0) break; // queues drained
    await page.waitForTimeout(500);
  }
}

test('source golden path: add → fetch → done → feed → filter → clear', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);
  await login(page);

  await page.goto('/sources');
  await page.fill('input[name="name"]', 'E2E Source');
  await page.fill('input[name="url"]', RSS_URL);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('E2E Source')).toBeVisible();

  await drainUntilDone(page);

  await page.goto('/admin/jobs');
  await expect(page.getByText(/Done:\s*1/)).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'E2E Pipeline Item' })).toBeVisible();
  await page.getByRole('link', { name: 'E2E Source' }).first().click();
  await expect(page).toHaveURL(/\?source=/);
  await expect(page.getByText(/Source: E2E Source/)).toBeVisible();
  await page.getByText('✕ Clear').click();
  await expect(page).toHaveURL('http://localhost:3000/');
});
```

- [ ] **Step 2: Failure-retry spec**

Create `apps/web/e2e/jobs-retry.spec.ts` (seeds a `failed` item via SQL against the e2e DB, mirroring `global-setup.ts`):

```ts
import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou_e2e';
const FAILED_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

test.beforeAll(async () => {
  const sql = postgres(DATABASE_URL);
  try {
    await sql`INSERT INTO items (id, url, url_hash, title, content_type, state, current_stage, attempts, last_error)
      VALUES (${FAILED_ID}, 'https://x/failed', 'failedhash', 'Failed Item', 'article', 'failed', 'embed', 3, 'boom: provider down')
      ON CONFLICT (id) DO UPDATE SET state='failed', current_stage='embed', attempts=3, last_error='boom: provider down'`;
  } finally { await sql.end(); }
});

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="password"]', 'e2e-password');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/login/);
}

test('failure triage: panel shows error → retry restores', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);
  await login(page);
  await page.goto('/admin/jobs');
  await expect(page.getByText('Failed Item')).toBeVisible();
  await page.getByText('Last error').click();
  await expect(page.getByText('boom: provider down')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).first().click();
  await expect(page.getByText('Failed Item')).toBeHidden();
});
```

- [ ] **Step 3: Form-retention regression spec**

Create `apps/web/e2e/form-retention.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="password"]', 'e2e-password');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/login/);
}

test('settings: invalid submit keeps entered values', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);
  await login(page);
  await page.goto('/settings');
  // Unreachable base url → connectivity test fails.
  await page.fill('input[name="llmProvider"]', 'openai-compatible');
  await page.fill('input[name="llmBaseUrl"]', 'http://localhost:1/v1');
  await page.fill('input[name="llmModel"]', 'my-typed-model');
  await page.fill('input[name="embedModel"]', 'my-typed-embed');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('input[name="llmModel"]')).toHaveValue('my-typed-model');
  await expect(page.locator('input[name="embedModel"]')).toHaveValue('my-typed-embed');
});
```

- [ ] **Step 4: Run the full e2e suite**

Run: `pnpm --filter @benkyou/web test:e2e`
Expected: PASS for the three new specs **and** the existing `golden-path`, `smoke`, `embedding-dimensions` specs. If flow 1's `drainUntilDone` flakes on the `score` stage, apply the fallback from the Phase H note.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/sources.spec.ts apps/web/e2e/jobs-retry.spec.ts apps/web/e2e/form-retention.spec.ts
git commit -m "test(web/e2e): source golden path, failure retry, form retention"
```

### Task 19: Documentation sync (spec §9)

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-benkyou-design.md`, `docs/superpowers/specs/2026-06-10-m1c-observability-design.md`, `CLAUDE.md`

- [ ] **Step 1: Mother spec milestone table (§9.1, §9.2)**

In `docs/superpowers/specs/2026-05-27-benkyou-design.md` §15: insert an `M1c` row after `M1`; remove "`/admin/jobs` failure retry UI" from the `M3` row; delete the 5-month / 22-week schedule framing and the "week" column.

- [ ] **Step 2: Mother spec schema (§9.3)**

In §5, add the `ai_usage` table (12th table) and `sources.last_fetch_error`. Note `items.updated_at` (added by this milestone for panel "last activity") as a corrected gap.

- [ ] **Step 3: Mother spec §9.1/§9.4 UI**

Expand the `/admin/jobs` description from "failed-task list + retry" to the six-section panel of M1c §6.1. In §9.4, annotate the card "source badge" as clickable → per-source filter.

- [ ] **Step 4: Correct the M1c design's call-site count**

In `docs/superpowers/specs/2026-06-10-m1c-observability-design.md` §5 and §4.1, fix the instrumented-site list to the four real sites (`embed`, `score`, `summary`, `deep_summary`) and note `score`'s LLM call is live in M1 (not M3+).

- [ ] **Step 5: CLAUDE.md (§9.5)**

In `CLAUDE.md`, delete the "5-month solo build" schedule phrasing from the Project section (keep "solo build by a frontend developer learning full-stack").

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-05-27-benkyou-design.md docs/superpowers/specs/2026-06-10-m1c-observability-design.md CLAUDE.md
git commit -m "docs: sync mother spec + CLAUDE.md for M1c (panel, ai_usage, schedule removal)"
```

---

## Phase I — Final gate

### Task 20: Full CI parity

- [ ] **Step 1: Run the complete CI command set**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm test
```

Expected: all PASS.

- [ ] **Step 2: Run e2e once more clean**

Run: `pnpm test:e2e` (assumes `docker compose up -d postgres` and the `benkyou_e2e` DB exist).
Expected: PASS.

- [ ] **Step 3: Final commit if cleanup was needed**

```bash
git add -A
git commit -m "chore: M1c final lint/i18n/test cleanup"
```

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §3.1 `ai_usage` ledger + instrumentation → Tasks 1–3 (corrected to 4 call sites).
- §3.2 / §6.1 `/admin/jobs` six-section panel + retry → Tasks 8, 9, 14 (+ AutoRefresh Task 12).
- §3.3 / §6.2 `/sources` CRUD + per-source status + fetch-now → Tasks 5, 6, 13.
- §3.4 / §6.3 feed source association → Tasks 7, 15.
- §3.5 / §6.4 form-retention fix → Task 11.
- §3.6 / §9 docs sync → Task 19.
- §4.1 `ai_usage` schema, §4.2 `sources.last_fetch_error`, §4.3 delete semantics → Tasks 1, 6.
- §5 instrumentation chokepoint in `core/ai` → Tasks 2, 3.
- §6.1 orphan detection, dimension drift, stalled highlight, anchors, AutoRefresh → Tasks 8, 12, 14.
- §7 error boundaries (best-effort ledger, retry race, orphan false-positive harmless, delete-with-inflight no-op, AutoRefresh silent-skip) → Tasks 2, 9, 14, plus the existing `runItemStage` guard.
- §8 tests: core TDD (usage/status/retry/listFeed/sources CRUD/ingest handler) → Tasks 2–9; e2e three flows → Task 18; i18n CI → Task 16.

**Deviations flagged (not silent):** four AI call sites not three (Tasks 3, 19.4); added `items.updated_at` (Tasks 1, 4, 19.2); relocated `triggerSourceFetch` (Task 6). The delete-with-inflight no-op (§7) relies on `runItemStage`'s existing "item not in required state → return" guard: a cascade-deleted item's queued job finds `getItemState` returns `undefined` ≠ required state → silent ack. No extra task; call it out if the orphan/delete interaction surfaces during e2e.

**Type consistency:** `FeedItem.sourceId` added in Task 7, consumed in Task 15 (`SourceBadge`); `SourceWithStats` from Task 6 consumed in Task 13; `getPipelineStatus` return shape from Task 8 consumed field-for-field in Task 14; `retryItem` signature from Task 9 consumed in Task 14's action; `SettingsState.dim` rename (was `values:{got,want}`) propagated to `SettingsForm.tsx` and its unit test (Task 11).

**Open risk to watch:** e2e flow 1 depends on the structured-output provider mock for the `score` stage (Phase H note). If the openai-compatible provider uses tool-mode rather than `response_format` for `generateObject`, extend the mock to emit a `tool_calls` response, or apply the seed-a-done-item fallback.

---

## Post-Review 遗留（2026-06-12 code review）

Review 的 Critical=0；Important×3 与 Minor #4/#5/#6/#11 已在本分支修复（`registerQueues` updateQueue、search embedding 记账、e2e 干净环境 7/7、deleteSource 事务、action id 校验、注释措辞）。以下为**未修复**的遗留，M2 规划时处理或显式再推迟：

1. **`retryItemAction` 丢弃 `RetryResult`**（`apps/web/app/(authed)/admin/jobs/actions.ts`）：`requeued: false` 时用户无反馈。当前 UI 只对 failed/orphan 渲染按钮所以影响小，但 `reason` 字段算出来又扔掉了。修法：action 返回 state + 面板显示一条 toast/提示。
2. **`AutoRefresh` 硬编码 `jobs` i18n namespace**（`apps/web/components/AutoRefresh.tsx`）：组件同时挂在 `/sources`，恰好 key 通用才没出错。修法：namespace 作 prop 或把共享 key 移到公共 namespace。
3. **`deep_summary` 的 usage 记录无测试**（`usage-points.int.test.ts` 只覆盖 embed/score/summary）：`onFinish` 路径在 AI SDK 升级时最容易静默坏。M2 做 wrapper 层收口时一并补（收口时记得删调用点埋点防双计，见 spec §3.1 记账位置注）。

已在 spec 有记录、无需重复跟踪：token 面板"今日"按 DB 时区（UTC，spec 推迟时区到 M3）；`getOrphans` 每 5s 的 jsonb `NOT EXISTS` 扫描成本（单用户规模可接受，job retention 拉长时重审，spec §6.1 orphan 设计注）。

Reviewer 流程建议（M2 e2e 任务可采纳）：global-setup 断言被测 server 实际连接 `benkyou_e2e`（如 `/health` 回显库名）——`reuseExistingServer` 静默复用连错库的旧 server 这次真实发生过。
