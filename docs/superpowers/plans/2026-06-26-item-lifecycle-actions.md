# Item Lifecycle Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single user reprocess a `done`/degraded item from `extract`, delete any item, and see a dedup-aware "already imported" panel on re-paste — instead of the current silent no-op.

**Architecture:** A shared `resetAndEnqueue(itemId, stage)` engine helper (refactored out of `retryItem`) resets an item to a stage's legal front-state and re-enqueues it, with app-level snapshot/restore compensation if enqueue fails. `reprocessItem` (restart from `extract`) and the existing `retryItem` (resume from `current_stage`) both ride on it. New thin API routes expose reprocess/retry/delete on the item page; `pasteUrl` returns a richer `existing` payload so the paste modal surfaces status instead of navigating.

**Tech Stack:** TypeScript 5.7 strict (`noUncheckedIndexedAccess`), Drizzle ORM, pg-boss 12, Next.js 16 App Router (route handlers + client components), next-intl 4, Vitest 4 (Testcontainers-backed `*.int.test.ts`), Playwright.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-06-26-item-lifecycle-actions-design.md`) and AGENTS.md. Every task's requirements implicitly include this section.

- **6-stage state machine untouched.** Reprocess only resets to a *legal front state* (`pending`) and re-enqueues — identical to a fresh paste. States: `pending → extracted → embedded → scored → dedup_done → done` (+ `failed`).
- **No schema migration for this feature.** Delete uses existing cascades + app-level cluster cleanup.
- **Single-user, no `user_id`.** No multi-tenancy anywhere.
- **All user-visible queries filter `state='done'`** (feed + item detail). Untouched.
- **Provider/queue plumbing untouched.** No `singletonKey` added to stage jobs (deferred, YAGNI). No CSRF middleware (pre-existing cross-cutting gap, §9). No `canonical_item` FK added (pre-existing, §9 — compensated in `deleteItem`).
- **API routes are thin** and guarded by `requireApiAuth()` (returns a 401 `Response` or `null`). Business logic lives in `@benkyou/core`.
- **Named exports only** (no default exports; Next.js pages/layouts/route-handler files are exempt).
- **TS strict**: no `any` without `// @ts-expect-error` + reason. `noUncheckedIndexedAccess` is on — indexed access yields `T | undefined`; narrow or `?? fallback`.
- **i18n**: every user-visible string goes through `useTranslations()`. CI (`pnpm check:i18n`) fails on any key present in one of `apps/web/messages/{en,zh}.json` but missing in the other — add new keys to **both**.
- **Tokens-only UI** in `apps/web/components`: no raw hex, no Tailwind arbitrary-value brackets (`p-[13px]`, `bg-[#abc]`), no inline `style=`. Available color tokens (from `apps/web/app/globals.css` `@theme inline`): `bg`, `surface`, `surface-2`, `ink`, `muted`, `faint`, `line`, `accent`, `accent-vivid`, `accent-soft`, `err`. New controls are structurally-neutral shells marked `{/* DESIGN-GAP: … */}` for a later impeccable polish pass.
- **TDD where there's logic** (engine, delete, status helper, paste shape, route status-mapping): failing test first.
- **Conventional commits**, one per task.

**Before submitting (CI runs all):** `pnpm lint && pnpm typecheck && pnpm check:i18n && pnpm build && pnpm test`. Core tests: `pnpm --filter @benkyou/core test`. Web tests: `pnpm --filter @benkyou/web test`. `*.int.test.ts` need a postgres container up (the shared test-db harness).

---

## File Structure

**Core (`packages/core/src`)**
- `pipeline/reprocess.ts` — **new**. `resetAndEnqueue(itemId, stage)` (the shared tail) + `reprocessItem(itemId)`.
- `pipeline/retry.ts` — **modify**. `retryItem` delegates to `resetAndEnqueue`; correct the "queue dedup" overclaim comment.
- `pipeline/index.ts` — **modify**. Add `export * from './reprocess'`.
- `items/delete.ts` — **new**. `deleteItem(itemId)` in a transaction (cascades + cluster cleanup).
- `items/pipeline-view.ts` — **modify**. Add `describeItemStatus()` + `ItemStatusDescriptor`.
- `items/paste.ts` — **modify**. `PasteResult` becomes a discriminated union; richer `existing` payload via a shared `existingResult` helper.
- `items/index.ts` — **modify**. Export `deleteItem`, `describeItemStatus`, `ItemStatusDescriptor`.

**Web (`apps/web`)**
- `app/api/items/[id]/reprocess/route.ts` — **new** (POST).
- `app/api/items/[id]/retry/route.ts` — **new** (POST).
- `app/api/items/[id]/route.ts` — **new** (DELETE).
- `components/ItemActions.tsx` — **new**. Client; resume/reprocess/delete buttons gated by state.
- `components/FeedItemDeleteButton.tsx` — **new**. Client; feed-row delete.
- `components/PipelineStepper.tsx` — **modify**. Drop the embedded retry form + `itemId` prop (ItemActions now owns resume).
- `components/PasteModal.tsx` — **modify**. Render the "already imported" panel on `existing`.
- `components/ItemCard.tsx` — **modify**. Mount `FeedItemDeleteButton` (z-10 above the stretched link).
- `app/(authed)/items/[id]/page.tsx` — **modify**. Mount `ItemActions` in both render branches; stop passing `itemId` to `PipelineStepper`.
- `messages/en.json`, `messages/zh.json` — **modify**. New keys under `item.actions`, `paste.status` + panel keys, `feed`.

**Tests**
- `packages/core/test/pipeline/reprocess.int.test.ts` — **new** (happy path + re-run absorption).
- `packages/core/test/pipeline/reprocess-comp.int.test.ts` — **new** (compensation, mocked queue).
- `packages/core/test/items/delete.int.test.ts` — **new**.
- `packages/core/test/items/pipeline-view.test.ts` — **modify** (add `describeItemStatus`).
- `packages/core/test/items/paste.int.test.ts` — **modify** (new `existing` shape).
- `apps/web/app/api/items/[id]/route.test.ts` — **new** (DELETE status mapping).
- `apps/web/app/api/items/[id]/reprocess/route.test.ts` — **new** (reprocess status mapping).
- `apps/web/app/api/items/[id]/retry/route.test.ts` — **new** (retry status mapping).
- `apps/web/e2e/paste.spec.ts` — **modify** (dup paste now shows panel, not auto-jump).
- `apps/web/e2e/item-lifecycle.spec.ts` — **new** (reprocess transition + feed delete).

---

## Task 1: `resetAndEnqueue` engine + compensation, retry refactor

Extract the shared tail of `retryItem` into `resetAndEnqueue`, add snapshot/restore compensation, and prove the existing retry path is unchanged.

**Files:**
- Create: `packages/core/src/pipeline/reprocess.ts`
- Modify: `packages/core/src/pipeline/retry.ts`
- Modify: `packages/core/src/pipeline/index.ts`
- Test (create): `packages/core/test/pipeline/reprocess-comp.int.test.ts`
- Test (unchanged, must stay green): `packages/core/test/pipeline/retry.int.test.ts`

**Interfaces:**
- Consumes: `getDbClient`, `items` (`../db`); `getBoss`, `registerQueues`, `enqueueStage` (`../queue`); `STAGE_REQUIRED_STATE`, `PER_ITEM_STAGES`, `ItemState`, `PerItemStage` (`./state`).
- Produces: `resetAndEnqueue(itemId: string, stage: PerItemStage): Promise<void>` — resets `(state,current_stage,attempts,last_error)` to the stage's front-state and enqueues it; on enqueue failure restores the captured snapshot and rethrows. Used by Task 2 (`reprocessItem`) and by the refactored `retryItem`.

- [ ] **Step 1: Write the failing compensation test**

Create `packages/core/test/pipeline/reprocess-comp.int.test.ts`. It mocks the queue module so `enqueueStage` throws, then asserts the snapshot is restored.

```ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

// enqueueStage throws → resetAndEnqueue must restore the pre-call snapshot.
vi.mock('../../src/queue/index.js', () => ({
  getBoss: vi.fn(async () => ({})),
  registerQueues: vi.fn(async () => {}),
  enqueueStage: vi.fn(async () => {
    throw new Error('enqueue boom');
  }),
}));

describe('resetAndEnqueue compensation', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let reprocess: typeof import('../../src/pipeline/reprocess.js');
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/reprocess-comp.int.test');
    sql = db.sql;
    await sql`INSERT INTO user_settings (id, password_hash, embed_dim) VALUES (1, 'x', 1536)`;
    ({ closeDbClient } = await import('../../src/db/client.js'));
    reprocess = await import('../../src/pipeline/reprocess.js');
  }, 120_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('done item: enqueue failure restores snapshot and rethrows', async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, current_stage, attempts, last_error, transcript_status)
      VALUES ('https://x/comp-done', 'comp-done', 'D', 'video', 'done', NULL, 0, NULL, 'unavailable')
      RETURNING id`;
    const id = rows[0]!.id;
    await expect(reprocess.resetAndEnqueue(id, 'extract')).rejects.toThrow('enqueue boom');
    const after = await sql<{ state: string; current_stage: string | null; attempts: number; last_error: string | null }[]>`
      SELECT state, current_stage, attempts, last_error FROM items WHERE id = ${id}`;
    expect(after[0]).toMatchObject({ state: 'done', current_stage: null, attempts: 0, last_error: null });
  });

  test('failed item: enqueue failure restores snapshot and rethrows', async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, current_stage, attempts, last_error)
      VALUES ('https://x/comp-failed', 'comp-failed', 'F', 'article', 'failed', 'embed', 3, 'boom')
      RETURNING id`;
    const id = rows[0]!.id;
    await expect(reprocess.resetAndEnqueue(id, 'extract')).rejects.toThrow('enqueue boom');
    const after = await sql<{ state: string; current_stage: string | null; attempts: number; last_error: string | null }[]>`
      SELECT state, current_stage, attempts, last_error FROM items WHERE id = ${id}`;
    expect(after[0]).toMatchObject({ state: 'failed', current_stage: 'embed', attempts: 3, last_error: 'boom' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @benkyou/core test reprocess-comp`
Expected: FAIL — cannot resolve `../../src/pipeline/reprocess.js` (module not created yet).

- [ ] **Step 3: Create `reprocess.ts` with `resetAndEnqueue`**

Create `packages/core/src/pipeline/reprocess.ts`:

```ts
import { eq } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { getBoss, registerQueues, enqueueStage } from '../queue';
import { STAGE_REQUIRED_STATE, type ItemState, type PerItemStage } from './state';

/**
 * Shared tail of retry/reprocess: snapshot the item, reset it to `stage`'s legal
 * front-state, and enqueue that stage. If enqueue throws, restore the snapshot
 * and rethrow so the item is not stranded in a forever-`pending` progress page
 * (app-level compensation; the main spec §428 deliberately rejected transactional
 * send). A process crash *between* the UPDATE and the send still orphans the item
 * — that residual is what /admin/jobs orphan repair covers (spec §2).
 */
export async function resetAndEnqueue(itemId: string, stage: PerItemStage): Promise<void> {
  const db = getDbClient();
  const prior = await db
    .select({
      state: items.state,
      currentStage: items.currentStage,
      attempts: items.attempts,
      lastError: items.lastError,
    })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  const snap = prior[0];
  if (!snap) throw new Error(`Item not found: ${itemId}`);

  const preState: ItemState = STAGE_REQUIRED_STATE[stage];
  await db
    .update(items)
    .set({ state: preState, currentStage: stage, attempts: 0, lastError: null, updatedAt: new Date() })
    .where(eq(items.id, itemId));

  try {
    const boss = await getBoss();
    await registerQueues(boss);
    await enqueueStage(boss, stage, itemId);
  } catch (err) {
    await db
      .update(items)
      .set({
        state: snap.state,
        currentStage: snap.currentStage,
        attempts: snap.attempts,
        lastError: snap.lastError,
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));
    throw err;
  }
}
```

- [ ] **Step 4: Refactor `retry.ts` to use `resetAndEnqueue` and fix the comment**

Replace the body of `packages/core/src/pipeline/retry.ts` with:

```ts
import { eq } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { PER_ITEM_STAGES, type PerItemStage } from './state';
import { resetAndEnqueue } from './reprocess';

export interface RetryResult {
  requeued: boolean;
  reason?: 'not-retryable' | 'no-stage';
}

function isPerItemStage(s: string | null): s is PerItemStage {
  return s != null && (PER_ITEM_STAGES as readonly string[]).includes(s);
}

/**
 * Recover a failed or orphaned (in-flight, no queued job) item: resume from
 * current_stage. Powers both the "[retry]" (failed) and "[re-enqueue]" (orphan)
 * buttons. Re-running the stage is absorbed by runItemStage's state guard
 * (runner.ts:26) under serial execution — a second job reads a state past the
 * stage's required pre-state and no-ops. Under concurrent workers a duplicate run
 * is possible but data-safe (embed onConflictDoUpdate, single cluster) and bounded
 * to wasted tokens; there is NO queue-level singletonKey on stage jobs (spec §2).
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

  await resetAndEnqueue(itemId, item.currentStage);
  return { requeued: true };
}
```

- [ ] **Step 5: Export the new module from the pipeline barrel**

In `packages/core/src/pipeline/index.ts`, add after `export * from './retry';`:

```ts
export * from './reprocess';
```

- [ ] **Step 6: Run the compensation test + existing retry test**

Run: `pnpm --filter @benkyou/core test reprocess-comp retry.int`
Expected: PASS — compensation test green (both cases) AND `retry.int.test.ts` still green (the refactor preserves behavior; note `resetAndEnqueue` now also sets `current_stage = stage`, which equals the existing value on the retry path, so assertions are unaffected).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pipeline/reprocess.ts packages/core/src/pipeline/retry.ts packages/core/src/pipeline/index.ts packages/core/test/pipeline/reprocess-comp.int.test.ts
git commit -m "refactor(pipeline): extract resetAndEnqueue with enqueue-failure compensation"
```

---

## Task 2: `reprocessItem` + re-run absorption

Restart-from-`extract` on top of `resetAndEnqueue`, plus the data-safety / stale-job-drop guarantees the spec calls the "real guarantee" (not "queue dedup").

**Files:**
- Modify: `packages/core/src/pipeline/reprocess.ts`
- Test (create): `packages/core/test/pipeline/reprocess.int.test.ts`

**Interfaces:**
- Consumes: `resetAndEnqueue` (Task 1); `runItemStage` (`../queue` / `../../src/queue/runner.js`); `dedupItem` (`../../src/pipeline/dedup.js`).
- Produces: `reprocessItem(itemId: string): Promise<ReprocessResult>` where `interface ReprocessResult { requeued: boolean; reason?: 'not-found' | 'in-flight' }`. Used by Task 6's reprocess route. Guard: only `state ∈ {done, failed}` is reprocessable.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/pipeline/reprocess.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import type { PgBoss } from 'pg-boss';
import postgres from 'postgres';

describe('reprocessItem + re-run absorption', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let boss: PgBoss;
  let reprocess: typeof import('../../src/pipeline/reprocess.js');
  let runner: typeof import('../../src/queue/runner.js');
  let dedup: typeof import('../../src/pipeline/dedup.js');
  let closeDbClient: () => Promise<void>;
  let closeBoss: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/reprocess.int.test');
    sql = db.sql;
    await sql`INSERT INTO user_settings (id, password_hash, embed_dim) VALUES (1, 'x', 1536)`;
    const { getBoss, registerQueues, closeBoss: _cb } = await import('../../src/queue/index.js');
    closeBoss = _cb;
    boss = await getBoss();
    await registerQueues(boss);
    ({ closeDbClient } = await import('../../src/db/client.js'));
    reprocess = await import('../../src/pipeline/reprocess.js');
    runner = await import('../../src/queue/runner.js');
    dedup = await import('../../src/pipeline/dedup.js');
  }, 180_000);

  afterAll(async () => {
    await closeBoss?.();
    await closeDbClient?.();
    await db?.cleanup();
  });

  async function seed(hash: string, state: string, transcript = 'na'): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, current_stage, attempts, last_error, transcript_status)
      VALUES (${'https://x/' + hash}, ${hash}, 'T', 'video', ${state}, NULL, 0, NULL, ${transcript})
      RETURNING id`;
    return rows[0]!.id;
  }

  test('done+degraded item resets to pending/extract and enqueues extract', async () => {
    const id = await seed('rp-done', 'done', 'unavailable');
    const res = await reprocess.reprocessItem(id);
    expect(res).toEqual({ requeued: true });
    const row = await sql<{ state: string; current_stage: string; attempts: number; last_error: string | null }[]>`
      SELECT state, current_stage, attempts, last_error FROM items WHERE id = ${id}`;
    expect(row[0]).toMatchObject({ state: 'pending', current_stage: 'extract', attempts: 0, last_error: null });
    const jobs = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job WHERE name='extract' AND data->>'itemId'=${id} AND state IN ('created','retry','active')`;
    expect(jobs[0]!.n).toBe(1);
  });

  test('failed item also restarts from extract', async () => {
    const id = await seed('rp-failed', 'failed');
    const res = await reprocess.reprocessItem(id);
    expect(res).toEqual({ requeued: true });
    const row = await sql<{ state: string; current_stage: string }[]>`
      SELECT state, current_stage FROM items WHERE id = ${id}`;
    expect(row[0]).toMatchObject({ state: 'pending', current_stage: 'extract' });
  });

  test('in-flight item is rejected', async () => {
    const id = await seed('rp-inflight', 'extracted');
    expect(await reprocess.reprocessItem(id)).toEqual({ requeued: false, reason: 'in-flight' });
  });

  test('non-existent item is not-found', async () => {
    expect(await reprocess.reprocessItem('00000000-0000-0000-0000-000000000000')).toEqual({
      requeued: false,
      reason: 'not-found',
    });
  });

  test('stale extract job is dropped by the state guard (re-run absorption)', async () => {
    // Item already advanced past extract's required pre-state ('pending').
    const id = await seed('rp-stale', 'extracted');
    // runItemStage must no-op: the real extract handler is never invoked.
    await runner.runItemStage(boss, { itemId: id, stage: 'extract' });
    const row = await sql<{ state: string; attempts: number }[]>`
      SELECT state, attempts FROM items WHERE id = ${id}`;
    expect(row[0]).toMatchObject({ state: 'extracted', attempts: 0 }); // unchanged; beginStage never ran
  });

  test('dedup re-run is data-safe: a single cluster per canonical item', async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state, topic_tags)
      VALUES ('https://x/rp-dedup', 'rp-dedup', 'T', 'article', 'scored', ARRAY['k'])
      RETURNING id`;
    const id = rows[0]!.id;
    await dedup.dedupItem(id);
    await dedup.dedupItem(id); // redelivery / reprocess re-run
    const clusters = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM event_clusters WHERE canonical_item = ${id}`;
    expect(clusters[0]!.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @benkyou/core test reprocess.int`
Expected: FAIL — `reprocess.reprocessItem is not a function`.

- [ ] **Step 3: Add `reprocessItem` to `reprocess.ts`**

Append to `packages/core/src/pipeline/reprocess.ts`:

```ts
export interface ReprocessResult {
  requeued: boolean;
  reason?: 'not-found' | 'in-flight';
}

/**
 * Restart an item from `extract` (re-fetch the source). Only `done` or `failed`
 * items are reprocessable — rejecting in-flight items prevents double-processing
 * a live pipeline. extract independently decides whether to hand off to the
 * Layer-2 transcribe stage, so reprocess needs no transcribe awareness (spec §2).
 */
export async function reprocessItem(itemId: string): Promise<ReprocessResult> {
  const db = getDbClient();
  const rows = await db
    .select({ state: items.state })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  const item = rows[0];
  if (!item) return { requeued: false, reason: 'not-found' };
  if (item.state !== 'done' && item.state !== 'failed') {
    return { requeued: false, reason: 'in-flight' };
  }
  await resetAndEnqueue(itemId, 'extract');
  return { requeued: true };
}
```

(Compensation on enqueue failure is inherited from `resetAndEnqueue` — already covered by Task 1's test; no need to re-test here.)

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @benkyou/core test reprocess.int`
Expected: PASS — all six tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/reprocess.ts packages/core/test/pipeline/reprocess.int.test.ts
git commit -m "feat(pipeline): reprocessItem restart-from-extract with re-run absorption tests"
```

---

## Task 3: `deleteItem` (cascades + cluster cleanup)

Hard delete in a transaction, compensating for the missing `event_clusters.canonical_item` FK.

**Files:**
- Create: `packages/core/src/items/delete.ts`
- Modify: `packages/core/src/items/index.ts`
- Test (create): `packages/core/test/items/delete.int.test.ts`

**Interfaces:**
- Consumes: `getDbClient`, `items`, `eventClusters` (`../db`); `and`, `eq`, `lte` (`drizzle-orm`).
- Produces: `deleteItem(itemId: string): Promise<{ deleted: boolean }>`. Used by Task 6's DELETE route.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/items/delete.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('deleteItem', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let deleteItem: typeof import('../../src/items/delete.js')['deleteItem'];
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('items/delete.int.test');
    sql = db.sql;
    await sql`INSERT INTO user_settings (id, password_hash, embed_dim) VALUES (1, 'x', 1536)`;
    ({ deleteItem } = await import('../../src/items/delete.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('removes item + cascade children, preserves ai_usage (item_id NULL), cleans its 1:1 cluster', async () => {
    const itemRows = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, state)
      VALUES ('https://x/del', 'del-hash', 'Del', 'article', 'done')
      RETURNING id`;
    const id = itemRows[0]!.id;

    // 1:1 cluster owned by this item (what dedupItem produces).
    const clusterRows = await sql<{ id: string }[]>`
      INSERT INTO event_clusters (canonical_item, keywords, item_count) VALUES (${id}, ARRAY['k'], 1) RETURNING id`;
    await sql`UPDATE items SET cluster_id = ${clusterRows[0]!.id} WHERE id = ${id}`;

    // item_embeddings (CASCADE) — vector(1536) literal of zeros.
    const vec = '[' + Array(1536).fill(0).join(',') + ']';
    await sql`INSERT INTO item_embeddings (item_id, embedding, title_emb) VALUES (${id}, ${vec}::vector, ${vec}::vector)`;

    // digest_items (CASCADE) needs a parent digest.
    const digestRows = await sql<{ id: string }[]>`INSERT INTO digests (date) VALUES ('2026-06-26') RETURNING id`;
    await sql`INSERT INTO digest_items (digest_id, item_id, category, rank) VALUES (${digestRows[0]!.id}, ${id}, 'knowledge', 1)`;

    // ai_usage (SET NULL — ledger preserved).
    await sql`INSERT INTO ai_usage (item_id, stage, kind, model, total_tokens) VALUES (${id}, 'embed', 'embedding', 'm', 10)`;

    const res = await deleteItem(id);
    expect(res).toEqual({ deleted: true });

    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM items WHERE id = ${id}`)[0]!.n).toBe(0);
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM item_embeddings WHERE item_id = ${id}`)[0]!.n).toBe(0);
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM digest_items WHERE item_id = ${id}`)[0]!.n).toBe(0);
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM event_clusters WHERE canonical_item = ${id}`)[0]!.n).toBe(0);
    const usage = await sql<{ n: number; nulls: number }[]>`
      SELECT count(*)::int AS n, count(*) FILTER (WHERE item_id IS NULL)::int AS nulls FROM ai_usage WHERE stage = 'embed' AND model = 'm'`;
    expect(usage[0]).toMatchObject({ n: 1, nulls: 1 });
  });

  test('deleting a non-existent item reports deleted=false', async () => {
    expect(await deleteItem('00000000-0000-0000-0000-000000000000')).toEqual({ deleted: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @benkyou/core test delete.int`
Expected: FAIL — cannot resolve `../../src/items/delete.js`.

- [ ] **Step 3: Write `delete.ts`**

Create `packages/core/src/items/delete.ts`:

```ts
import { and, eq, lte } from 'drizzle-orm';
import { eventClusters, getDbClient, items } from '../db';

/**
 * Hard delete an item (no undo/trash — spec §6). Children clean up via FK:
 * item_embeddings/digest_items CASCADE, ai_usage SET NULL (ledger preserved).
 * event_clusters.canonical_item has NO FK (spec §9 divergence), so its cleanup
 * is app-level here.
 */
export async function deleteItem(itemId: string): Promise<{ deleted: boolean }> {
  const db = getDbClient();
  return db.transaction(async (tx) => {
    // M3 TODO (real multi-item clustering): when clusters hold >1 member,
    // deleteItem must also decrement item_count for any deleted member and
    // synchronously re-elect canonical_item when the deleted item was canonical.
    // The M1 dedup stub only ever makes 1:1 clusters, so the two statements below
    // suffice today. The SET ... NULL line is an anti-dangling safety only; it
    // does NOT maintain item_count.
    await tx
      .delete(eventClusters)
      .where(and(eq(eventClusters.canonicalItem, itemId), lte(eventClusters.itemCount, 1)));
    await tx
      .update(eventClusters)
      .set({ canonicalItem: null })
      .where(eq(eventClusters.canonicalItem, itemId));

    const deleted = await tx.delete(items).where(eq(items.id, itemId)).returning({ id: items.id });
    return { deleted: deleted.length > 0 };
  });
}
```

- [ ] **Step 4: Export from the items barrel**

In `packages/core/src/items/index.ts`, add:

```ts
export { deleteItem } from './delete';
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @benkyou/core test delete.int`
Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/items/delete.ts packages/core/src/items/index.ts packages/core/test/items/delete.int.test.ts
git commit -m "feat(items): deleteItem with cascade + 1:1 cluster cleanup"
```

---

## Task 4: `describeItemStatus` helper

A core helper that maps an item's `(state, currentStage, transcriptStatus)` to an i18n key descriptor, reusing the `mapStep` vocabulary. Renders the modal's status label.

**Files:**
- Modify: `packages/core/src/items/pipeline-view.ts`
- Modify: `packages/core/src/items/index.ts`
- Test (modify): `packages/core/test/items/pipeline-view.test.ts`

**Interfaces:**
- Consumes: `mapStep`, `PIPELINE_STEPS`, `PipelineStep` (same file).
- Produces: `interface ItemStatusDescriptor { key: 'done' | 'doneNoTranscript' | 'failed' | 'inFlight'; stepKey?: PipelineStep }` and `describeItemStatus(state, currentStage, transcriptStatus): ItemStatusDescriptor`. Used by `PasteModal` (Task 8). `stepKey` is set only for `failed` (the user-facing pipeline step the failure sits on).

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/items/pipeline-view.test.ts`:

```ts
import { describeItemStatus } from '../../src/items/pipeline-view';

describe('describeItemStatus', () => {
  test('done + present → done', () => {
    expect(describeItemStatus('done', null, 'present')).toEqual({ key: 'done' });
  });
  test('done + unavailable → doneNoTranscript', () => {
    expect(describeItemStatus('done', null, 'unavailable')).toEqual({ key: 'doneNoTranscript' });
  });
  test('failed → failed + user-facing step from current_stage', () => {
    expect(describeItemStatus('failed', 'embed', 'na')).toEqual({ key: 'failed', stepKey: 'embed' });
    expect(describeItemStatus('failed', 'extract', 'na')).toEqual({ key: 'failed', stepKey: 'extract' });
  });
  test('failed with null stage falls back to extract', () => {
    expect(describeItemStatus('failed', null, 'na')).toEqual({ key: 'failed', stepKey: 'extract' });
  });
  test('in-flight states → inFlight', () => {
    expect(describeItemStatus('pending', 'extract', 'na')).toEqual({ key: 'inFlight' });
    expect(describeItemStatus('scored', 'dedup', 'na')).toEqual({ key: 'inFlight' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @benkyou/core test pipeline-view`
Expected: FAIL — `describeItemStatus` not exported.

- [ ] **Step 3: Implement `describeItemStatus`**

Append to `packages/core/src/items/pipeline-view.ts`:

```ts
export interface ItemStatusDescriptor {
  // i18n key under the modal's 'paste.status' namespace.
  key: 'done' | 'doneNoTranscript' | 'failed' | 'inFlight';
  // The user-facing pipeline step a failure sits on (only set when key === 'failed').
  stepKey?: PipelineStep;
}

/**
 * Describe an item's terminal/in-flight status for the re-paste modal (spec §4),
 * reusing the mapStep vocabulary so the failed step name matches the stepper.
 */
export function describeItemStatus(
  state: string,
  currentStage: string | null,
  transcriptStatus: string,
): ItemStatusDescriptor {
  if (state === 'done') {
    return transcriptStatus === 'unavailable' ? { key: 'doneNoTranscript' } : { key: 'done' };
  }
  if (state === 'failed') {
    const view = mapStep('failed', currentStage, transcriptStatus, null);
    return { key: 'failed', stepKey: PIPELINE_STEPS[view.activeIndex] ?? 'extract' };
  }
  return { key: 'inFlight' };
}
```

- [ ] **Step 4: Export from the items barrel**

In `packages/core/src/items/index.ts`, update the pipeline-view exports line to include the helper and its type:

```ts
export { mapStep, PIPELINE_STEPS, describeItemStatus } from './pipeline-view';
export type { PipelineStep, StepView, ItemStatusDescriptor } from './pipeline-view';
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @benkyou/core test pipeline-view`
Expected: PASS — existing `mapStep` tests + new `describeItemStatus` tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/items/pipeline-view.ts packages/core/src/items/index.ts packages/core/test/items/pipeline-view.test.ts
git commit -m "feat(items): describeItemStatus for re-paste status labels"
```

---

## Task 5: `pasteUrl` returns a dedup-aware `existing` payload

Change `PasteResult` to a discriminated union so the modal can render status instead of silently navigating.

**Files:**
- Modify: `packages/core/src/items/paste.ts`
- Test (modify): `packages/core/test/items/paste.int.test.ts`

**Interfaces:**
- Consumes: `ItemState`, `PerItemStage` (`../pipeline/state`); `TranscriptStatus` (`../sources/types`).
- Produces:
  ```ts
  export type PasteResult =
    | { created: string }
    | { existing: { id: string; state: ItemState; currentStage: PerItemStage | null;
                    transcriptStatus: TranscriptStatus; title: string } };
  ```
  Consumers must narrow with `'created' in result`. Used by the paste route (pass-through) and `PasteModal` (Task 8).

- [ ] **Step 1: Update the paste tests to the new shape (failing)**

Replace the three tests in `packages/core/test/items/paste.int.test.ts` (keep the imports/setup/teardown):

```ts
  test('new url -> created + pending item + enqueued extract', async () => {
    const r = await pasteUrl('https://example.com/post-1');
    if (!('created' in r)) throw new Error('expected created');
    const rows = await sql<{ state: string; current_stage: string; source_id: string | null; content_type: string }[]>`
      SELECT state, current_stage, source_id, content_type FROM items WHERE id = ${r.created}`;
    expect(rows[0]!.state).toBe('pending');
    expect(rows[0]!.current_stage).toBe('extract');
    expect(rows[0]!.source_id).toBeNull();
    const jobs = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'extract' AND data->>'itemId' = ${r.created}`;
    expect(jobs[0]!.n).toBe(1);
  });

  test('duplicate url (normalized) -> existing payload, no new row', async () => {
    const first = await pasteUrl('https://example.com/post-2');
    if (!('created' in first)) throw new Error('expected created');
    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM items`;
    const dup = await pasteUrl('https://example.com/post-2?utm_source=x'); // utm_* stripped → same url_hash
    if (!('existing' in dup)) throw new Error('expected existing');
    expect(dup.existing.id).toBe(first.created);
    expect(dup.existing).toMatchObject({
      id: first.created,
      state: 'pending',
      currentStage: 'extract',
      transcriptStatus: expect.any(String),
      title: expect.any(String),
    });
    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM items`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  test('youtube url -> initial content_type video', async () => {
    const r = await pasteUrl('https://youtu.be/dQw4w9WgXcQ');
    if (!('created' in r)) throw new Error('expected created');
    const rows = await sql<{ content_type: string }[]>`SELECT content_type FROM items WHERE id = ${r.created}`;
    expect(rows[0]!.content_type).toBe('video');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @benkyou/core test paste.int`
Expected: FAIL — `dup.existing` is a string, not an object (`'existing' in dup` ok, but `dup.existing.id` is undefined / type error).

- [ ] **Step 3: Rewrite `paste.ts` with the union + shared `existingResult` helper**

Replace `packages/core/src/items/paste.ts` with:

```ts
import { eq } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { urlHash } from '../util/url';
import { detectAdhocType, detectAdhocMedia } from '../sources';
import { getBoss, registerQueues, enqueueStage } from '../queue';
import type { ItemState, PerItemStage } from '../pipeline/state';
import type { TranscriptStatus } from '../sources/types';

export type PasteResult =
  | { created: string }
  | {
      existing: {
        id: string;
        state: ItemState;
        currentStage: PerItemStage | null;
        transcriptStatus: TranscriptStatus;
        title: string;
      };
    };

// Initial content_type so the feed/progress UI shows the right kind before extract
// runs. extract overwrites it from the adapter's ExtractResult.
function initialContentType(url: string): 'article' | 'video' {
  return detectAdhocType(url) === 'article' ? 'article' : 'video';
}

// Shared by both dedup-hit paths (existing-hash and lost-insert-race) so they
// return the identical shape (spec §4 / §7).
async function existingResult(db: ReturnType<typeof getDbClient>, hash: string): Promise<PasteResult> {
  const rows = await db
    .select({
      id: items.id,
      state: items.state,
      currentStage: items.currentStage,
      transcriptStatus: items.transcriptStatus,
      title: items.title,
    })
    .from(items)
    .where(eq(items.urlHash, hash))
    .limit(1);
  const e = rows[0]!;
  return {
    existing: {
      id: e.id,
      state: e.state as ItemState,
      currentStage: e.currentStage as PerItemStage | null,
      transcriptStatus: e.transcriptStatus as TranscriptStatus,
      title: e.title,
    },
  };
}

export async function pasteUrl(rawUrl: string): Promise<PasteResult> {
  const db = getDbClient();
  const hash = urlHash(rawUrl);

  const existing = await db.select({ id: items.id }).from(items).where(eq(items.urlHash, hash)).limit(1);
  if (existing[0]) return existingResult(db, hash);

  const media = detectAdhocMedia(rawUrl);
  const contentType = media ? media.contentType : initialContentType(rawUrl);

  const inserted = await db
    .insert(items)
    .values({
      sourceId: null,
      externalId: null,
      url: rawUrl,
      urlHash: hash,
      title: rawUrl, // URL placeholder; extract overwrites it via resolveTitle once the adapter finds a real title
      contentType,
      mediaUrl: media ? rawUrl : null, // for direct-media the canonical url IS the download source
      rawContent: null,
      state: 'pending',
      currentStage: 'extract',
    })
    .onConflictDoNothing()
    .returning({ id: items.id });

  // Lost the insert race against a concurrent paste of the same url → treat as dup.
  if (!inserted[0]) return existingResult(db, hash);

  const boss = await getBoss();
  await registerQueues(boss); // idempotent; ensures the extract queue exists
  await enqueueStage(boss, 'extract', inserted[0].id);
  return { created: inserted[0].id };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @benkyou/core test paste.int`
Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/items/paste.ts packages/core/test/items/paste.int.test.ts
git commit -m "feat(items): pasteUrl returns dedup-aware existing payload"
```

---

## Task 6: Item API routes (reprocess / retry / delete)

Three thin route handlers, each `requireApiAuth`-guarded, mapping core results to HTTP status.

**Files:**
- Create: `apps/web/app/api/items/[id]/reprocess/route.ts`
- Create: `apps/web/app/api/items/[id]/retry/route.ts`
- Create: `apps/web/app/api/items/[id]/route.ts`
- Test (create): `apps/web/app/api/items/[id]/reprocess/route.test.ts`
- Test (create): `apps/web/app/api/items/[id]/retry/route.test.ts`
- Test (create): `apps/web/app/api/items/[id]/route.test.ts`

**Interfaces:**
- Consumes: `reprocessItem`, `retryItem` (`@benkyou/core/pipeline`); `deleteItem` (`@benkyou/core/items`); `requireApiAuth` (`@/lib/auth`).
- Produces: `POST /api/items/:id/reprocess`, `POST /api/items/:id/retry`, `DELETE /api/items/:id`. 200 + result JSON on success; 409 when reprocess/retry can't requeue; 404 when delete finds nothing; 401 when unauthenticated. Consumed by `ItemActions`, `PasteModal`, `FeedItemDeleteButton`.

- [ ] **Step 1: Write the failing route tests**

Create `apps/web/app/api/items/[id]/reprocess/route.test.ts`:

```ts
import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@benkyou/core/pipeline', () => ({ reprocessItem: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireApiAuth: vi.fn(async () => null) }));

import { POST } from './route';
import { reprocessItem } from '@benkyou/core/pipeline';
import { requireApiAuth } from '@/lib/auth';

const ctx = { params: Promise.resolve({ id: 'item-1' }) };
const req = new Request('http://x/api/items/item-1/reprocess', { method: 'POST' });

describe('POST /api/items/:id/reprocess', () => {
  beforeEach(() => vi.clearAllMocks());

  test('200 when requeued', async () => {
    vi.mocked(reprocessItem).mockResolvedValue({ requeued: true });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(reprocessItem)).toHaveBeenCalledWith('item-1');
  });

  test('409 when not requeued', async () => {
    vi.mocked(reprocessItem).mockResolvedValue({ requeued: false, reason: 'in-flight' });
    expect((await POST(req, ctx)).status).toBe(409);
  });

  test('401 when unauthenticated', async () => {
    vi.mocked(requireApiAuth).mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    expect((await POST(req, ctx)).status).toBe(401);
  });
});
```

Create `apps/web/app/api/items/[id]/retry/route.test.ts` (identical shape, retry semantics):

```ts
import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@benkyou/core/pipeline', () => ({ retryItem: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireApiAuth: vi.fn(async () => null) }));

import { POST } from './route';
import { retryItem } from '@benkyou/core/pipeline';

const ctx = { params: Promise.resolve({ id: 'item-1' }) };
const req = new Request('http://x/api/items/item-1/retry', { method: 'POST' });

describe('POST /api/items/:id/retry', () => {
  beforeEach(() => vi.clearAllMocks());

  test('200 when requeued', async () => {
    vi.mocked(retryItem).mockResolvedValue({ requeued: true });
    expect((await POST(req, ctx)).status).toBe(200);
  });

  test('409 when not requeued', async () => {
    vi.mocked(retryItem).mockResolvedValue({ requeued: false, reason: 'not-retryable' });
    expect((await POST(req, ctx)).status).toBe(409);
  });
});
```

Create `apps/web/app/api/items/[id]/route.test.ts`:

```ts
import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@benkyou/core/items', () => ({ deleteItem: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireApiAuth: vi.fn(async () => null) }));

import { DELETE } from './route';
import { deleteItem } from '@benkyou/core/items';
import { requireApiAuth } from '@/lib/auth';

const ctx = { params: Promise.resolve({ id: 'item-1' }) };
const req = new Request('http://x/api/items/item-1', { method: 'DELETE' });

describe('DELETE /api/items/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  test('200 when deleted', async () => {
    vi.mocked(deleteItem).mockResolvedValue({ deleted: true });
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(deleteItem)).toHaveBeenCalledWith('item-1');
  });

  test('404 when nothing deleted', async () => {
    vi.mocked(deleteItem).mockResolvedValue({ deleted: false });
    expect((await DELETE(req, ctx)).status).toBe(404);
  });

  test('401 when unauthenticated', async () => {
    vi.mocked(requireApiAuth).mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    expect((await DELETE(req, ctx)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @benkyou/web test items/[id]`
Expected: FAIL — route modules don't exist yet.

- [ ] **Step 3: Write the three route handlers**

Create `apps/web/app/api/items/[id]/reprocess/route.ts`:

```ts
import { reprocessItem } from '@benkyou/core/pipeline';
import { requireApiAuth } from '@/lib/auth';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await params;
  const result = await reprocessItem(id);
  return Response.json(result, { status: result.requeued ? 200 : 409 });
}
```

Create `apps/web/app/api/items/[id]/retry/route.ts`:

```ts
import { retryItem } from '@benkyou/core/pipeline';
import { requireApiAuth } from '@/lib/auth';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await params;
  const result = await retryItem(id);
  return Response.json(result, { status: result.requeued ? 200 : 409 });
}
```

Create `apps/web/app/api/items/[id]/route.ts`:

```ts
import { deleteItem } from '@benkyou/core/items';
import { requireApiAuth } from '@/lib/auth';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await params;
  const result = await deleteItem(id);
  return Response.json(result, { status: result.deleted ? 200 : 404 });
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter @benkyou/web test items/[id]`
Expected: PASS — all route tests green.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/api/items/[id]"
git commit -m "feat(web): item reprocess/retry/delete API routes"
```

---

## Task 7: `ItemActions` cluster + item page wiring + PipelineStepper cleanup

The item detail page gets a state-gated lifecycle cluster. Resume moves out of `PipelineStepper` (which becomes a pure stepper) into `ItemActions`, killing the double-retry-button risk and honoring AGENTS.md "presentation stays logic-free".

**Files:**
- Create: `apps/web/components/ItemActions.tsx`
- Modify: `apps/web/components/PipelineStepper.tsx`
- Modify: `apps/web/app/(authed)/items/[id]/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/zh.json`

**Interfaces:**
- Consumes: reprocess/retry/delete routes (Task 6); `useTranslations('item')`; `useRouter`.
- Produces: `<ItemActions itemId={string} state={string} />`. Gating: always Delete; `failed` → Resume (primary) + Reprocess (confirm); `done` → Reprocess (confirm); other (in-flight) → Delete only.

- [ ] **Step 1: Add i18n keys to both locales**

In `apps/web/messages/en.json`, add an `actions` object inside `item`:

```json
"actions": {
  "resume": "Resume",
  "reprocess": "Reprocess",
  "delete": "Delete",
  "reprocessConfirm": "Re-run the whole pipeline? This re-spends tokens.",
  "deleteConfirm": "Delete permanently? This can't be undone."
}
```

In `apps/web/messages/zh.json`, add inside `item`:

```json
"actions": {
  "resume": "从失败步续跑",
  "reprocess": "从头重跑",
  "delete": "删除",
  "reprocessConfirm": "会重跑整条 pipeline,重新消耗 token。确定?",
  "deleteConfirm": "删除后不可恢复,确定删除?"
}
```

- [ ] **Step 2: Create `ItemActions.tsx`**

Create `apps/web/components/ItemActions.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';

// Lifecycle actions for the item detail page. A single `pending` flag guards
// against double-submit (spec §2/§3). On a non-2xx response we stay put — the
// item is still in the feed thanks to resetAndEnqueue's compensation (spec §2).
export function ItemActions({ itemId, state }: { itemId: string; state: string }) {
  const t = useTranslations('item');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const failed = state === 'failed';
  const canReprocess = state === 'done' || failed;

  async function run(req: () => Promise<Response>, onOk: () => void): Promise<void> {
    setPending(true);
    try {
      const res = await req();
      if (res.ok) onOk();
      // DESIGN-GAP: surface a non-2xx error toast in the impeccable pass.
    } finally {
      setPending(false);
    }
  }

  function resume(): void {
    void run(() => fetch(`/api/items/${itemId}/retry`, { method: 'POST' }), () => router.refresh());
  }
  function reprocess(): void {
    if (!window.confirm(t('actions.reprocessConfirm'))) return;
    void run(() => fetch(`/api/items/${itemId}/reprocess`, { method: 'POST' }), () => router.refresh());
  }
  function remove(): void {
    if (!window.confirm(t('actions.deleteConfirm'))) return;
    void run(() => fetch(`/api/items/${itemId}`, { method: 'DELETE' }), () => router.push('/' as Route));
  }

  return (
    // DESIGN-GAP: lifecycle action cluster — structurally-neutral buttons; impeccable polishes later.
    <div className="flex flex-wrap items-center gap-2">
      {failed ? (
        <button
          type="button"
          onClick={resume}
          disabled={pending}
          className="rounded-md bg-accent-vivid px-3 py-1.5 text-sm text-bg disabled:opacity-50"
        >
          {t('actions.resume')}
        </button>
      ) : null}
      {canReprocess ? (
        <button
          type="button"
          onClick={reprocess}
          disabled={pending}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink disabled:opacity-50"
        >
          {t('actions.reprocess')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="rounded-md border border-line px-3 py-1.5 text-sm text-err disabled:opacity-50"
      >
        {t('actions.delete')}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Make `PipelineStepper` a pure stepper**

In `apps/web/components/PipelineStepper.tsx`: remove the `retryItemAction` import (line 5), drop `itemId` from the props type and signature, and replace the failed block's retry `<form>` with just the error text. The new failed block:

```tsx
      {view.failed && lastError ? (
        <pre className="whitespace-pre-wrap text-xs text-muted">{lastError}</pre>
      ) : null}
```

So the component signature becomes:

```tsx
export function PipelineStepper({ view, lastError }: { view: StepView; lastError: string | null }) {
```

(Leave the stepper `<ol>` exactly as-is. The admin `/admin/jobs` retry — `RetryButton` + `retryItemAction` — is a separate component and stays untouched.)

- [ ] **Step 4: Wire `ItemActions` into the item page and update the stepper call**

In `apps/web/app/(authed)/items/[id]/page.tsx`:

Add the import near the others:
```tsx
import { ItemActions } from '@/components/ItemActions';
```

In the **progress branch**, change the stepper line and add actions after the `ConfirmTranscribe` block:
```tsx
        <PipelineStepper view={view} lastError={progress.lastError} />
        {progress.transcriptStatus === 'needs_confirmation' ? (
          <ConfirmTranscribe
            itemId={progress.id}
            estimatedMinutes={Math.round((progress.durationSec ?? 0) / 60)}
          />
        ) : null}
        <ItemActions itemId={progress.id} state={progress.state} />
```

In the **done branch**, add the cluster as the last child of `<header>` (after the `ExtractNotice` block, still inside `</header>`):
```tsx
        <div className="mt-3">
          <ItemActions itemId={item.id} state="done" />
        </div>
```

- [ ] **Step 5: Verify lint, types, i18n, build**

Run: `pnpm --filter @benkyou/web lint && pnpm typecheck && pnpm check:i18n && pnpm build`
Expected: PASS — no `retryItemAction`/`itemId` type errors in `PipelineStepper`; i18n key parity holds; client/server boundary clean (`ItemActions` imports no DB barrel).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ItemActions.tsx apps/web/components/PipelineStepper.tsx "apps/web/app/(authed)/items/[id]/page.tsx" apps/web/messages/en.json apps/web/messages/zh.json
git commit -m "feat(web): item-page lifecycle actions cluster; PipelineStepper back to pure stepper"
```

---

## Task 8: Dedup-aware re-paste panel in `PasteModal`

On a dedup hit, render an "already imported" panel (status + View + Reprocess) instead of silently navigating.

**Files:**
- Modify: `apps/web/components/PasteModal.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/zh.json`
- Test (modify): `apps/web/e2e/paste.spec.ts`

**Interfaces:**
- Consumes: `pasteUrl` result union via `/api/items/paste`; `describeItemStatus` from `@benkyou/core/items/pipeline-view` (leaf module — client-safe, no DB; same import style `PipelineStepper` already uses); reprocess route (Task 6).
- Produces: panel UI. [重新处理] shown only when `existing.state ∈ {done, failed}`.

- [ ] **Step 1: Add i18n keys to both locales**

In `apps/web/messages/en.json`, extend `paste` with a `status` object and panel keys:

```json
"alreadyImported": "Already imported",
"view": "View",
"reprocess": "Reprocess",
"reprocessCost": "re-spends tokens",
"status": {
  "done": "Done",
  "doneNoTranscript": "Done · no subtitles",
  "failed": "Failed at {step}",
  "inFlight": "Processing"
}
```

In `apps/web/messages/zh.json`, extend `paste`:

```json
"alreadyImported": "这条已导入过",
"view": "查看",
"reprocess": "重新处理",
"reprocessCost": "将重新消耗 token",
"status": {
  "done": "已完成",
  "doneNoTranscript": "已完成 · 无字幕",
  "failed": "处理失败于 {step}",
  "inFlight": "处理中"
}
```

(The `{step}` placeholder is filled with a value from the existing `pipeline` namespace — `fetch`/`extract`/`embed`/`score`/`done` — which already exists in both locales.)

- [ ] **Step 2: Update `PasteModal.tsx`**

Replace `apps/web/components/PasteModal.tsx` with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import { describeItemStatus } from '@benkyou/core/items/pipeline-view';
import { PASTE_EVENT } from './shell/commands';

type Existing = {
  id: string;
  state: string;
  currentStage: string | null;
  transcriptStatus: string;
  title: string;
};
type PasteResponse = { created?: string; existing?: Existing };

export function PasteModal({ aiConfigured }: { aiConfigured: boolean }) {
  const t = useTranslations('paste');
  const tp = useTranslations('pipeline');
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [existing, setExisting] = useState<Existing | null>(null);

  useEffect(() => {
    const open = (): void => {
      setUrl('');
      setError(null);
      setExisting(null);
      ref.current?.showModal();
    };
    window.addEventListener(PASTE_EVENT, open);
    return () => window.removeEventListener(PASTE_EVENT, open);
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setExisting(null);
    setPending(true);
    try {
      const res = await fetch('/api/items/paste', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.status === 409) {
        setError(t('aiRequired'));
        return;
      }
      if (!res.ok) {
        setError(t('failed'));
        return;
      }
      const data = (await res.json()) as PasteResponse;
      if (data.created) {
        ref.current?.close();
        router.push(`/items/${data.created}` as Route);
      } else if (data.existing) {
        setExisting(data.existing); // surface status instead of navigating (spec §4)
      }
    } finally {
      setPending(false);
    }
  }

  function statusLabel(e: Existing): string {
    const desc = describeItemStatus(e.state, e.currentStage, e.transcriptStatus);
    return desc.key === 'failed'
      ? t('status.failed', { step: tp(desc.stepKey ?? 'extract') })
      : t(`status.${desc.key}`);
  }

  function view(id: string): void {
    ref.current?.close();
    router.push(`/items/${id}` as Route);
  }

  async function reprocess(id: string): Promise<void> {
    setPending(true);
    try {
      const res = await fetch(`/api/items/${id}/reprocess`, { method: 'POST' });
      if (res.ok) {
        ref.current?.close();
        router.push(`/items/${id}` as Route);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    // DESIGN-GAP: modal chrome — neutral centered dialog for now.
    <dialog ref={ref} className="m-auto w-full max-w-md rounded-md bg-surface p-5 text-ink backdrop:bg-ink/25">
      <h2 className="mb-3 font-serif text-lg font-semibold">{t('title')}</h2>
      {!aiConfigured ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t('aiRequired')}</p>
          <div className="flex justify-end">
            <button type="button" onClick={() => ref.current?.close()} className="rounded-md border border-line px-3 py-1.5 text-sm">
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : existing ? (
        // DESIGN-GAP: already-imported panel — structurally-neutral; impeccable polishes later.
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium text-ink">{t('alreadyImported')}</p>
            <p className="mt-1 text-sm text-muted">
              {existing.title} · {statusLabel(existing)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => view(existing.id)} className="rounded-md border border-line px-3 py-1.5 text-sm">
              {t('view')}
            </button>
            {existing.state === 'done' || existing.state === 'failed' ? (
              <>
                <button
                  type="button"
                  onClick={() => void reprocess(existing.id)}
                  disabled={pending}
                  className="rounded-md bg-accent-vivid px-3 py-1.5 text-sm text-bg disabled:opacity-50"
                >
                  {t('reprocess')}
                </button>
                <span className="text-xs text-faint">· {t('reprocessCost')}</span>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('placeholder')}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          {error ? <p className="text-sm text-muted">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => ref.current?.close()} className="rounded-md border border-line px-3 py-1.5 text-sm">
              {t('cancel')}
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-accent-vivid px-3 py-1.5 text-sm text-bg disabled:opacity-50">
              {t('submit')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
```

- [ ] **Step 3: Update the duplicate-paste e2e (now a panel, not auto-jump)**

In `apps/web/e2e/paste.spec.ts`, replace the second test body (`pasting a duplicate URL …`) with:

```ts
  test('pasting a duplicate URL shows the already-imported panel', async ({ page }) => {
    // First paste — creates the item.
    await page.getByPlaceholder(/Paste|粘贴/).fill('https://example.com/e2e-dup');
    await page.getByRole('button', { name: /^Add$|^添加$/ }).click();
    await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
    const firstUrl = page.url();

    // Back to feed and re-paste the same canonical URL (utm_* stripped).
    await page.goto('/');
    await expect(page.getByPlaceholder(/Paste|粘贴/)).toBeVisible();
    await page.getByPlaceholder(/Paste|粘贴/).fill('https://example.com/e2e-dup?utm_source=x');
    await page.getByRole('button', { name: /^Add$|^添加$/ }).click();

    // Panel appears instead of navigating; View jumps to the existing item.
    await expect(page.getByText(/Already imported|这条已导入过/)).toBeVisible();
    await page.getByRole('button', { name: /^View$|^查看$/ }).click();
    await expect(page).toHaveURL(firstUrl);
  });
```

- [ ] **Step 4: Verify lint, types, i18n, build**

Run: `pnpm --filter @benkyou/web lint && pnpm typecheck && pnpm check:i18n && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/PasteModal.tsx apps/web/messages/en.json apps/web/messages/zh.json apps/web/e2e/paste.spec.ts
git commit -m "feat(web): dedup-aware re-paste panel in PasteModal"
```

---

## Task 9: Feed-row delete control

A per-row delete on the feed, clickable above `ItemCard`'s stretched link.

**Files:**
- Create: `apps/web/components/FeedItemDeleteButton.tsx`
- Modify: `apps/web/components/ItemCard.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/zh.json`

**Interfaces:**
- Consumes: DELETE route (Task 6); `useTranslations('feed')`; `useRouter`.
- Produces: `<FeedItemDeleteButton itemId={string} />`. Confirm → DELETE → `router.refresh()` (the `state='done'`-filtered feed re-renders without the row).

- [ ] **Step 1: Add i18n keys to both locales**

In `apps/web/messages/en.json`, add to `feed`:
```json
"delete": "Delete",
"deleteConfirm": "Delete permanently? This can't be undone."
```
In `apps/web/messages/zh.json`, add to `feed`:
```json
"delete": "删除",
"deleteConfirm": "删除后不可恢复,确定删除?"
```

- [ ] **Step 2: Create `FeedItemDeleteButton.tsx`**

Create `apps/web/components/FeedItemDeleteButton.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

// Feed-row delete. router.refresh() re-renders the (state='done'-filtered) feed
// without the deleted row. DESIGN-GAP: pre-refresh optimistic hiding + styled
// confirm are deferred to the impeccable pass.
export function FeedItemDeleteButton({ itemId }: { itemId: string }) {
  const t = useTranslations('feed');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove(): Promise<void> {
    if (!window.confirm(t('deleteConfirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${itemId}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    // DESIGN-GAP: feed-row delete affordance — structurally-neutral icon-less button.
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      aria-label={t('delete')}
      className="rounded-md px-2 py-0.5 text-xs text-faint transition-colors duration-150 hover:text-err disabled:opacity-50 motion-reduce:transition-none"
    >
      {t('delete')}
    </button>
  );
}
```

- [ ] **Step 3: Mount it in `ItemCard.tsx`**

In `apps/web/components/ItemCard.tsx`, add the import:
```tsx
import { FeedItemDeleteButton } from '@/components/FeedItemDeleteButton';
```

Replace the bookmark block (the `{item.bookmarked ? ( … ) : null}` span that uses `ml-auto`) with a trailing actions group that escapes the stretched link via `relative z-10`:

```tsx
        <span className="relative z-10 ml-auto flex items-center gap-2">
          {item.bookmarked ? (
            <span className="inline-flex shrink-0 items-center text-accent">
              <BookmarkIcon width={14} height={14} />
              <span className="sr-only">{t('bookmarked')}</span>
            </span>
          ) : null}
          <FeedItemDeleteButton itemId={item.id} />
        </span>
```

(`relative z-10` is required because `ItemCard`'s `<Link>` renders a full-row `::after` overlay; `SourceBadge` uses the same escape on line 49.)

- [ ] **Step 4: Verify lint, types, i18n, build**

Run: `pnpm --filter @benkyou/web lint && pnpm typecheck && pnpm check:i18n && pnpm build`
Expected: PASS — `ItemCard` stays a server component rendering a client child; no DB barrel pulled into the client.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/FeedItemDeleteButton.tsx apps/web/components/ItemCard.tsx apps/web/messages/en.json apps/web/messages/zh.json
git commit -m "feat(web): per-row delete control on the feed"
```

---

## Task 10: E2E — reprocess transition + feed delete

End-to-end coverage for the two flows that need a `done` item. The spec seeds its own items via a direct postgres connection (mirroring `e2e/global-setup.ts`) so it is independent of the shared seed and of test ordering. (The "already imported" panel flow is covered by `paste.spec.ts`, Task 8.)

**Files:**
- Create: `apps/web/e2e/item-lifecycle.spec.ts`

**Interfaces:**
- Consumes: the running e2e app + DB (`E2E_DATABASE_URL` || the default `…/benkyou_e2e`), the reprocess + delete routes, and `ItemActions` / `FeedItemDeleteButton` UI.

- [ ] **Step 1: Write the e2e spec**

Create `apps/web/e2e/item-lifecycle.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou_e2e';

const REPROCESS_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const DELETE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

test.describe('item lifecycle actions', () => {
  test.beforeAll(async () => {
    const sql = postgres(DATABASE_URL);
    try {
      // Two own `done` items so we never mutate the shared seed or depend on order.
      await sql`
        INSERT INTO items (id, url, url_hash, title, summary, raw_content, content_type, state, published_at)
        VALUES
          (${REPROCESS_ID}, 'https://example.com/reprocess-me', 'reprocess-me-hash', 'Reprocess Me',
           's', 'body', 'article', 'done', now()),
          (${DELETE_ID}, 'https://example.com/delete-me', 'delete-me-hash', 'Delete Me',
           's', 'body', 'article', 'done', now())
        ON CONFLICT (id) DO NOTHING`;
    } finally {
      await sql.end();
    }
  });

  test.afterAll(async () => {
    const sql = postgres(DATABASE_URL);
    try {
      await sql`DELETE FROM items WHERE id IN (${REPROCESS_ID}, ${DELETE_ID})`;
    } finally {
      await sql.end();
    }
  });

  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);
    await page.goto('/login');
    await page.fill('input[name="password"]', 'e2e-password');
    await page.click('button[type="submit"]');
    await expect(page.getByPlaceholder(/Paste|粘贴/)).toBeVisible();
  });

  test('reprocess on a done item transitions to the progress view', async ({ page }) => {
    page.on('dialog', (d) => d.accept()); // confirm dialog
    await page.goto(`/items/${REPROCESS_ID}`);
    await expect(page.getByRole('heading', { name: 'Reprocess Me' })).toBeVisible();
    await page.getByRole('button', { name: /^Reprocess$/ }).click();
    // No worker in e2e → item sits at pending → progress view renders.
    await expect(page.getByText(/Processing…|正在处理/)).toBeVisible();
  });

  test('feed-row delete removes the item', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await page.goto('/');
    const row = page.getByRole('article').filter({ hasText: 'Delete Me' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /^Delete$/ }).click();
    await expect(page.getByText('Delete Me')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the e2e suite**

Run (postgres must be up): `pnpm --filter @benkyou/web exec playwright test item-lifecycle`
Expected: PASS — both tests green. If the whole suite is run, confirm `paste.spec.ts` (Task 8 update) and the rest stay green.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/item-lifecycle.spec.ts
git commit -m "test(web): e2e for item reprocess transition and feed-row delete"
```

---

## Final verification

- [ ] **Run the full CI gate**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm build
pnpm test
```
Expected: all green. (E2E is run separately and needs postgres up — see Task 10.)

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §2 `resetAndEnqueue` refactor + compensation + comment fix | Task 1 |
| §2 `reprocessItem` guard + self-healing transcribe (extract-only) + re-run absorption / data idempotency | Task 2 |
| §3 item-page actions cluster (done / failed / in-flight gating), confirm on reprocess, double-submit guard, no-navigate on error | Task 7 |
| §3 API routes `POST …/reprocess`, `POST …/retry`, `DELETE …/:id` | Task 6 |
| §4 `PasteResult` union + `describeItemStatus` + modal panel + [查看]/[重新处理] + inline cost note | Tasks 4, 5, 8 |
| §5 `deleteItem` cascades + 1:1 cluster cleanup + `M3 TODO` + mid-flight safety (inherited from `runItemStage` guard) | Task 3 |
| §5 delete surfaces: item page + feed row | Tasks 7, 9 |
| §6 invariants preserved (6-stage machine, `state='done'` filter, single-user, no migration) | All — Global Constraints |
| §7 testing matrix (reprocess, absorption, compensation, retry-green, deleteItem, pasteUrl, describeItemStatus, e2e) | Tasks 1–10 |
| §9 divergences (cluster FK compensated in `deleteItem`; CSRF not introduced — routes use existing `requireApiAuth`) | Tasks 3, 6 |

**Gaps acknowledged:** §7's "lost-insert-race path same shape" has no dedicated test — triggering a real insert race is non-deterministic. Mitigated structurally: both dedup paths return the identical `existingResult(db, hash)` helper (Task 5), so the shape cannot diverge. This is a deliberate, documented choice, not an omission.

**2. Placeholder scan:** No `TBD`/`handle edge cases`/"similar to Task N" — every code step shows complete code; every run step shows the command + expected result.

**3. Type consistency:** `resetAndEnqueue(itemId, stage)` (Task 1) is consumed verbatim by `retryItem` (Task 1) and `reprocessItem` (Task 2). `ReprocessResult`/`RetryResult` `{ requeued, reason? }` shapes match what routes (Task 6) and their tests assert. `deleteItem → { deleted: boolean }` matches the DELETE route's 200/404 mapping. `PasteResult` union (Task 5) is narrowed with `'created' in result` in the modal (Task 8) and tests (Task 5). `ItemStatusDescriptor.stepKey: PipelineStep` (Task 4) feeds `tp(desc.stepKey ?? 'extract')` against the existing `pipeline` namespace (Task 8). `PipelineStepper` losing its `itemId` prop (Task 7) is matched by the updated call site in `page.tsx` (Task 7) — its only caller.
