# Benkyou M1a · Pipeline & Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full 6-stage content pipeline run headlessly: given an enabled RSS source, the worker fetches it, runs `ingest → extract → embed → score → dedup → summary`, and leaves items at `state='done'` with a summary, embedding, topic score, and cluster. Runnable in both worker modes (`docker` long-loop and `serverless` batch).

**Architecture:** All pipeline logic lives in `packages/core/src/pipeline/` as pure-ish stage handlers `(itemId) => Promise<void>`. Each stage advances `items.state` to the next value on success; on failure it writes `attempts++`/`last_error` and **does not change `state`** (pg-boss retries with backoff; the dead-letter queue sets `state='failed'` after `pipeline_max_attempts`). The worker (`apps/worker`) only wires pg-boss queues to these handlers — no business logic. `embed`/`score`/`summary` call LLM/embedding endpoints through the existing `@benkyou/core/ai` abstraction, configured from the single-row `user_settings`. `depth_score` and `dedup` are deliberate stubs this milestone.

**Tech Stack:** TypeScript 5.7, Drizzle ORM 0.45, pg-boss 12, Vercel AI SDK 6 (`ai`), `rss-parser` (feeds), `@mozilla/readability` + `jsdom` (article extraction), Vitest 4, Testcontainers 12, MSW 2.

> Versions below are an audited snapshot. Before starting, if more than ~2 weeks have passed, verify with `pnpm view <pkg> version` and bump the caret rather than silently downgrading (per AGENTS.md).

**Reference:** Spec `docs/superpowers/specs/2026-05-27-benkyou-design.md` §6 (pipeline), §7 (search — M1b), §5 (data model). Builds directly on M0 (`docs/superpowers/plans/2026-05-27-benkyou-m0-foundation.md`).

---

## Planner scope decisions (M1, adjust during review if needed)

The spec pins most of M1 (`depth_score=0.5` stub, dedup = always-new-cluster, RSS-only, digest deferred to M3). Three forks the spec left open were decided as follows:

1. **Search = full hybrid (§7)** — implemented in M1b, not here. M1a just guarantees every `done` item has an embedding + populated `search_vec`.
2. **Auth = minimal-but-correct** — M1b concern.
3. **Plan split into M1a (this doc) + M1b** — M1a is headless and fully testable without any UI. M1b (`auth → setup → trigger fetch → feed → detail → search`) depends on M1a being green.

**M1a definition of done:** an integration test starts a Postgres container, seeds one `sources` row (type `rss`) + one `user_settings` row, points the RSS adapter at an MSW-mocked feed, runs the whole pipeline through `processBatch`, and asserts the resulting item is `state='done'` with a non-null `summary`, a row in `item_embeddings`, `topic_score`/`category` set, `depth_score=0.5`, and a `cluster_id`.

---

## What M0 already gives us (do not re-create)

Verified against the current `packages/core` source — import these, don't rebuild them:

| Import | Provides |
|---|---|
| `@benkyou/core/config` | `env` (validated, never throws on import), `assertEnv()` (call once per process at startup), `Env` type |
| `@benkyou/core/db` | `getDbClient()` → Drizzle client (singleton), `closeDbClient()`, `sql` (re-export of drizzle-orm `sql`), and every table: `items`, `sources`, `itemEmbeddings`, `eventClusters`, `userSettings`, `sessions`, `digests`, `digestItems`, `conversations`, `messages` |
| `@benkyou/core/ai` | `resolveLLM(cfg)` → `ConcreteLanguageModel`, `resolveEmbedding(cfg)` → `EmbeddingModel`; `LLMConfig`/`EmbeddingConfig` = `{ provider: string; baseUrl?: string; apiKey?: string; model: string }` |
| `@benkyou/core/queue` | `getBoss()` → started `PgBoss` (singleton), `closeBoss()` |
| `apps/worker/src/index.ts` | entry: calls `assertEnv()`, dispatches `runLoop()` (docker) / exits (serverless) |
| `apps/worker/src/loop.ts` | `runLoop()` — **currently a never-resolving stub**; this plan replaces its body |
| `apps/worker/src/batch.ts` | `processBatch(maxJobs): Promise<{processed:number;errors:number}>` — **currently a stub**; this plan replaces its body |

Schema facts that matter here (all already migrated in M0, no schema change in M1a):
- `items.state` default `'pending'`; columns `currentStage`, `attempts` (NOT NULL default 0), `lastError`, `depthScore`, `topicScore`, `topicTags` (text[]), `category`, `clusterId`, `summary`, `rawContent`, `contentType`, `urlHash`, `externalId`, `sourceId`, `publishedAt`, `author`, `title`, `transcriptStatus` (default `'na'`).
- `items.searchVec` is a **generated** `tsvector` (from `title`+`summary`+`raw_content`) with a GIN index — it updates itself when `summary`/`raw_content` are written. M1a does nothing to it directly; M1b queries it.
- `item_embeddings`: `itemId` (PK, FK→items cascade), `embedding vector(EMBED_DIM)`, `titleEmb vector(EMBED_DIM)`, `modelId`. HNSW cosine indexes exist on both vectors.
- `items` unique indexes: `items_url_hash_uq` on `url_hash`; partial `items_source_ext_uq` on `(source_id, external_id)` where both not null.
- `user_settings` is a single row (`id=1`); `embedDim` is NOT NULL.

> **ESM import suffix convention — match existing neighbours, verified in M0 source:**
> - `packages/core/src/**` → relative imports use **no** `.js` suffix (e.g. `client.ts` does `import { env } from '../config/env'`). Every M0 core file does this; the Bundler `moduleResolution` + tsx/turbopack make it work. New core files must match.
> - `apps/worker/src/**` → relative imports **do** carry `.js` (e.g. `index.ts` does `await import('./loop.js')`).
> - test files (`packages/core/test/**`) → relative imports **do** carry `.js` (e.g. `boss.test.ts` does `import('../src/queue/boss.js')`).
> - **cross-package** imports always use the package subpath (`@benkyou/core/queue`), never a relative path into another package.
>
> ⚠️ **Doc/code discrepancy to raise with the maintainer (not blocking M1a):** `docs/dev/env-and-monorepo.md` ("Consuming @benkyou/core") states core relative imports use `.js`. The committed M0 code does **not** — it's extensionless and CI is green. This plan follows the *code*. Flag it so either the doc or the code gets reconciled; do not silently switch core to `.js` mid-milestone (it would make new files inconsistent with every existing one).

---

## File Structure (created/modified in M1a)

| Path | Responsibility |
|---|---|
| `packages/core/src/util/url.ts` | `normalizeUrl()` + `urlHash()` (sha256) — global dedup anchor |
| `packages/core/src/util/text.ts` | `truncateChars()` — bound text sent to embedding/LLM |
| `packages/core/src/sources/types.ts` | `RawItem`, `SourceAdapter` interfaces |
| `packages/core/src/sources/rss.ts` | `rssAdapter` — fetch + parse RSS/Atom → `RawItem[]` |
| `packages/core/src/sources/index.ts` | `getAdapter(type)` registry |
| `packages/core/src/settings/index.ts` | `getUserSettings()`, `buildLLMConfig()`, `buildEmbeddingConfig()` |
| `packages/core/src/pipeline/state.ts` | state-machine constants + `advanceState()` / `recordFailure()` |
| `packages/core/src/pipeline/ingest.ts` | `ingestSource(sourceId)` — list new items, enqueue `extract` |
| `packages/core/src/pipeline/extract.ts` | `extractItem(itemId)` — RSS full-text / Readability |
| `packages/core/src/pipeline/embed.ts` | `embedItem(itemId)` — write `item_embeddings` |
| `packages/core/src/pipeline/score.ts` | `scoreItem(itemId)` — LLM topic/category, `depth_score=0.5` stub |
| `packages/core/src/pipeline/dedup.ts` | `dedupItem(itemId)` — **stub**: always new cluster |
| `packages/core/src/pipeline/summary.ts` | `summarizeItem(itemId)` — LLM 1–2 sentence summary, set `done` |
| `packages/core/src/pipeline/index.ts` | `STAGES`, `STAGE_HANDLERS`, `runStage()` |
| `packages/core/src/queue/queues.ts` | queue names, `registerQueues()`, `enqueueStage()`, `checkDueSources()` |
| `apps/worker/src/loop.ts` | **replace stub** — docker long-loop: workers + due-source poller |
| `apps/worker/src/batch.ts` | **replace stub** — serverless: poll + drain queues once |
| `packages/core/test/util/url.test.ts` | unit: normalize + hash |
| `packages/core/test/sources/rss.test.ts` | unit (MSW): feed parsing |
| `packages/core/test/pipeline/state.test.ts` | unit: transitions + failure |
| `packages/core/test/pipeline/score.test.ts` | unit (mock AI): score shape + depth stub |
| `packages/core/test/pipeline/pipeline.int.test.ts` | integration (Testcontainers + MSW + mock AI): full run → `done` |
| `packages/core/package.json` | add deps (rss-parser, readability, jsdom, msw) |

---

## Phase M1a.0 · Dependencies

### Task 1: Add pipeline dependencies to `@benkyou/core`

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Add runtime + dev deps**

Edit `packages/core/package.json`. Add to `dependencies`:

```json
"rss-parser": "^3.13.0",
"@mozilla/readability": "^0.6.0",
"jsdom": "^26.0.0"
```

Add to `devDependencies`:

```json
"@types/jsdom": "^21.1.7",
"msw": "^2.7.0"
```

- [ ] **Step 2: Install**

```bash
pnpm install
```

Expected: lockfile updates, no peer-dependency errors.

- [ ] **Step 3: Verify the libs import under the project's ESM/TS setup**

```bash
pnpm --filter @benkyou/core exec node --input-type=module -e "import Parser from 'rss-parser'; import {Readability} from '@mozilla/readability'; import {JSDOM} from 'jsdom'; console.log(typeof Parser, typeof Readability, typeof JSDOM)"
```

Expected: `function function function`.

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "chore(core): add rss-parser, readability, jsdom, msw for M1 pipeline"
```

---

## Phase M1a.1 · URL + text utilities

### Task 2: `normalizeUrl` + `urlHash`

`url_hash` is the global dedup anchor (spec §5.3). Two URLs that differ only by tracking params / trailing slash / fragment / host case must hash equal.

**Files:**
- Create: `packages/core/src/util/url.ts`
- Test: `packages/core/test/util/url.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import { normalizeUrl, urlHash } from '../../src/util/url.js';

describe('normalizeUrl', () => {
  test('lowercases host, drops fragment and trailing slash', () => {
    expect(normalizeUrl('HTTPS://Example.com/Path/#frag')).toBe('https://example.com/Path');
  });

  test('strips tracking params but keeps real query, sorted', () => {
    expect(normalizeUrl('https://e.com/a?utm_source=x&b=2&a=1&fbclid=z')).toBe(
      'https://e.com/a?a=1&b=2',
    );
  });

  test('keeps root slash', () => {
    expect(normalizeUrl('https://e.com/')).toBe('https://e.com/');
  });
});

describe('urlHash', () => {
  test('is stable and equal for equivalent URLs', () => {
    expect(urlHash('https://e.com/a?utm_source=x')).toBe(urlHash('https://E.com/a/'));
  });

  test('differs for different paths', () => {
    expect(urlHash('https://e.com/a')).not.toBe(urlHash('https://e.com/b'));
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

```bash
pnpm --filter @benkyou/core exec vitest run test/util/url.test.ts
```

Expected: FAIL — `Cannot find module '../../src/util/url.js'`.

- [ ] **Step 3: Implement `packages/core/src/util/url.ts`**

```ts
import { createHash } from 'node:crypto';

// Query keys considered tracking noise and dropped before hashing.
const TRACKING = /^(utm_.*|fbclid|gclid|mc_eid|mc_cid|ref|ref_src|igshid)$/i;

export function normalizeUrl(input: string): string {
  const u = new URL(input);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();

  const kept: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams) {
    if (!TRACKING.test(k)) kept.push([k, v]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // Rebuild search deterministically.
  const search = new URLSearchParams();
  for (const [k, v] of kept) search.append(k, v);
  u.search = search.toString();

  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

export function urlHash(input: string): string {
  return createHash('sha256').update(normalizeUrl(input)).digest('hex');
}
```

- [ ] **Step 4: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/util/url.test.ts
```

Expected: PASS (5 assertions).

- [ ] **Step 5: Add `truncateChars` helper `packages/core/src/util/text.ts`**

The embed/score/summary stages must bound how much `raw_content` they send. Token-accurate truncation is overkill for M1; a generous char cap is fine (~4 chars/token).

```ts
export function truncateChars(input: string | null | undefined, max: number): string {
  if (!input) return '';
  return input.length <= max ? input : input.slice(0, max);
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/util packages/core/test/util
git commit -m "feat(core): url normalize/hash + text truncate utils"
```

---

## Phase M1a.2 · RSS source adapter

### Task 3: `SourceAdapter` contract + `rssAdapter`

**Files:**
- Create: `packages/core/src/sources/types.ts`, `packages/core/src/sources/rss.ts`, `packages/core/src/sources/index.ts`
- Test: `packages/core/test/sources/rss.test.ts`

- [ ] **Step 1: Write the source contract `packages/core/src/sources/types.ts`**

```ts
export interface RawItem {
  externalId: string | null; // feed guid / entry id; used for (source_id, external_id) dedup
  url: string;
  title: string;
  author: string | null;
  publishedAt: Date | null;
  content: string | null; // best full text the feed itself carried (content:encoded), else null
}

export interface SourceAdapter {
  readonly type: string;
  // config is the `sources.config` jsonb for this source (type-specific).
  fetchItems(config: Record<string, unknown>): Promise<RawItem[]>;
}
```

- [ ] **Step 2: Write the failing test `packages/core/test/sources/rss.test.ts`**

```ts
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { rssAdapter } from '../../src/sources/rss.js';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Hello World</title>
      <link>https://example.com/posts/hello</link>
      <guid>post-1</guid>
      <pubDate>Wed, 28 May 2026 10:00:00 GMT</pubDate>
      <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Jane</dc:creator>
      <content:encoded><![CDATA[<p>This is the full article body.</p>]]></content:encoded>
    </item>
    <item>
      <title>No Body</title>
      <link>https://example.com/posts/nobody</link>
      <guid>post-2</guid>
    </item>
  </channel>
</rss>`;

const server = setupServer(
  http.get('https://feeds.test/rss', () =>
    new HttpResponse(FEED, { headers: { 'content-type': 'application/rss+xml' } }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('rssAdapter', () => {
  test('parses items, mapping guid/link/date/creator/content', async () => {
    const items = await rssAdapter.fetchItems({ url: 'https://feeds.test/rss' });
    expect(items).toHaveLength(2);

    const first = items[0]!;
    expect(first.title).toBe('Hello World');
    expect(first.url).toBe('https://example.com/posts/hello');
    expect(first.externalId).toBe('post-1');
    expect(first.author).toBe('Jane');
    expect(first.publishedAt?.toISOString()).toBe('2026-05-28T10:00:00.000Z');
    expect(first.content).toContain('full article body');

    const second = items[1]!;
    expect(second.content).toBeNull(); // no content:encoded -> extract stage will fetch+Readability
  });

  test('rejects config without url', async () => {
    await expect(rssAdapter.fetchItems({})).rejects.toThrow(/config\.url/);
  });

  test('throws on non-2xx', async () => {
    server.use(http.get('https://feeds.test/rss', () => new HttpResponse(null, { status: 503 })));
    await expect(rssAdapter.fetchItems({ url: 'https://feeds.test/rss' })).rejects.toThrow(
      /RSS fetch failed: 503/,
    );
  });
});
```

- [ ] **Step 3: Run it; confirm it fails**

```bash
pnpm --filter @benkyou/core exec vitest run test/sources/rss.test.ts
```

Expected: FAIL — module `../../src/sources/rss.js` not found.

- [ ] **Step 4: Implement `packages/core/src/sources/rss.ts`**

```ts
import Parser from 'rss-parser';
import type { RawItem, SourceAdapter } from './types';

interface RssConfig {
  url: string;
}

interface FeedItem {
  guid?: string;
  link?: string;
  title?: string;
  creator?: string;
  author?: string;
  isoDate?: string;
  pubDate?: string;
  content?: string;
  contentEncoded?: string;
}

function isRssConfig(c: Record<string, unknown>): c is RssConfig {
  return typeof c.url === 'string' && c.url.length > 0;
}

export const rssAdapter: SourceAdapter = {
  type: 'rss',
  async fetchItems(config) {
    if (!isRssConfig(config)) {
      throw new Error('rss source requires config.url (string)');
    }
    const res = await fetch(config.url, {
      headers: { 'user-agent': 'benkyou/0.1 (+https://github.com/benkyou)' },
    });
    if (!res.ok) {
      throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
    }
    const xml = await res.text();

    // `content:encoded` is not a default rss-parser field; map it explicitly.
    const parser: Parser<unknown, FeedItem> = new Parser({
      customFields: { item: [['content:encoded', 'contentEncoded']] },
    });
    const feed = await parser.parseString(xml);

    return (feed.items ?? [])
      .map((it): RawItem => {
        const when = it.isoDate ?? it.pubDate ?? null;
        return {
          externalId: it.guid ?? it.link ?? null,
          url: it.link ?? '',
          title: it.title ?? '(untitled)',
          author: it.creator ?? it.author ?? null,
          publishedAt: when ? new Date(when) : null,
          content: it.contentEncoded ?? it.content ?? null,
        };
      })
      .filter((r) => r.url.length > 0);
  },
};
```

- [ ] **Step 5: Write the registry `packages/core/src/sources/index.ts`**

```ts
import type { SourceAdapter } from './types';
import { rssAdapter } from './rss';

const ADAPTERS = new Map<string, SourceAdapter>([[rssAdapter.type, rssAdapter]]);

export function getAdapter(type: string): SourceAdapter {
  const adapter = ADAPTERS.get(type);
  if (!adapter) throw new Error(`No source adapter registered for type: ${type}`);
  return adapter;
}

export type { RawItem, SourceAdapter } from './types';
```

- [ ] **Step 6: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/sources/rss.test.ts
```

Expected: PASS (3 tests). If `content:encoded` comes back undefined, confirm the `customFields` mapping name (`contentEncoded`) matches what the test reads.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sources packages/core/test/sources
git commit -m "feat(core/sources): RSS adapter with content:encoded + error paths"
```

---

## Phase M1a.3 · Settings access (single-row config)

The pipeline's AI stages read provider config from `user_settings` (id=1). Centralize that here so stages don't reach into the table directly.

**Files:**
- Create: `packages/core/src/settings/index.ts`
- Test: `packages/core/test/settings/config.test.ts`

- [ ] **Step 1: Write the failing test `packages/core/test/settings/config.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { buildEmbeddingConfig, buildLLMConfig } from '../../src/settings/index.js';
import type { UserSettings } from '../../src/settings/index.js';

function settings(overrides: Partial<UserSettings>): UserSettings {
  return overrides as unknown as UserSettings;
}

describe('buildLLMConfig', () => {
  test('uses cheap model when requested, falls back to main model', () => {
    const s = settings({
      llmProvider: 'openai',
      llmModel: 'gpt-4.1',
      llmCheapModel: 'gpt-4.1-mini',
      llmBaseUrl: null,
      llmApiKey: 'k',
    });
    expect(buildLLMConfig(s, { cheap: true })).toEqual({
      provider: 'openai',
      baseUrl: undefined,
      apiKey: 'k',
      model: 'gpt-4.1-mini',
    });
    expect(buildLLMConfig(s).model).toBe('gpt-4.1');
    expect(buildLLMConfig(settings({ llmProvider: 'openai', llmModel: 'gpt-4.1', llmCheapModel: null }), { cheap: true }).model).toBe('gpt-4.1');
  });

  test('throws when provider/model missing', () => {
    expect(() => buildLLMConfig(settings({ llmProvider: null, llmModel: null }))).toThrow(/LLM not configured/);
  });
});

describe('buildEmbeddingConfig', () => {
  test('maps embed_* fields', () => {
    const s = settings({ embedProvider: 'openai', embedModel: 'text-embedding-3-small', embedBaseUrl: null, embedApiKey: 'k' });
    expect(buildEmbeddingConfig(s)).toEqual({
      provider: 'openai',
      baseUrl: undefined,
      apiKey: 'k',
      model: 'text-embedding-3-small',
    });
  });

  test('throws when embedding not configured', () => {
    expect(() => buildEmbeddingConfig(settings({ embedProvider: null, embedModel: null }))).toThrow(/Embedding not configured/);
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

```bash
pnpm --filter @benkyou/core exec vitest run test/settings/config.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/settings/index.ts`**

```ts
import { eq } from 'drizzle-orm';
import { getDbClient, userSettings } from '../db';
import type { EmbeddingConfig, LLMConfig } from '../ai';

export type UserSettings = typeof userSettings.$inferSelect;

export async function getUserSettings(): Promise<UserSettings | null> {
  const db = getDbClient();
  const rows = await db.select().from(userSettings).where(eq(userSettings.id, 1)).limit(1);
  return rows[0] ?? null;
}

export function buildLLMConfig(s: UserSettings, opts?: { cheap?: boolean }): LLMConfig {
  const model = opts?.cheap ? (s.llmCheapModel ?? s.llmModel) : s.llmModel;
  if (!s.llmProvider || !model) {
    throw new Error('LLM not configured (llm_provider / llm_model missing in user_settings)');
  }
  return {
    provider: s.llmProvider,
    baseUrl: s.llmBaseUrl ?? undefined,
    apiKey: s.llmApiKey ?? undefined,
    model,
  };
}

export function buildEmbeddingConfig(s: UserSettings): EmbeddingConfig {
  if (!s.embedProvider || !s.embedModel) {
    throw new Error('Embedding not configured (embed_provider / embed_model missing in user_settings)');
  }
  return {
    provider: s.embedProvider,
    baseUrl: s.embedBaseUrl ?? undefined,
    apiKey: s.embedApiKey ?? undefined,
    model: s.embedModel,
  };
}
```

- [ ] **Step 4: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/settings/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/settings packages/core/test/settings
git commit -m "feat(core/settings): single-row settings access + provider config builders"
```

---

## Phase M1a.4 · Pipeline state machine

This is the load-bearing invariant (spec §6.1, AGENTS.md "Pipeline state machine"). Transitions are data; the DB mutators are tiny and centralized so no stage hand-rolls a state write.

**Files:**
- Create: `packages/core/src/pipeline/state.ts`
- Test: `packages/core/test/pipeline/state.test.ts`

- [ ] **Step 1: Write the failing test (pure transition tables — no DB)**

```ts
import { describe, expect, test } from 'vitest';
import {
  NEXT_STAGE,
  PER_ITEM_STAGES,
  STAGE_REQUIRED_STATE,
  STAGE_RESULT_STATE,
} from '../../src/pipeline/state.js';

describe('pipeline state tables', () => {
  test('stages form a single chain extract → embed → score → dedup → summary', () => {
    expect(PER_ITEM_STAGES).toEqual(['extract', 'embed', 'score', 'dedup', 'summary']);
    expect(NEXT_STAGE.extract).toBe('embed');
    expect(NEXT_STAGE.summary).toBeNull();
  });

  test('each stage requires its predecessor state and yields the next state', () => {
    expect(STAGE_REQUIRED_STATE.extract).toBe('pending');
    expect(STAGE_RESULT_STATE.extract).toBe('extracted');
    expect(STAGE_REQUIRED_STATE.embed).toBe('extracted');
    expect(STAGE_RESULT_STATE.summary).toBe('done');
  });

  test('required-state of a stage equals result-state of the previous stage', () => {
    for (let i = 1; i < PER_ITEM_STAGES.length; i++) {
      const prev = PER_ITEM_STAGES[i - 1]!;
      const cur = PER_ITEM_STAGES[i]!;
      expect(STAGE_REQUIRED_STATE[cur]).toBe(STAGE_RESULT_STATE[prev]);
    }
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

```bash
pnpm --filter @benkyou/core exec vitest run test/pipeline/state.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/pipeline/state.ts`**

```ts
import { eq, sql } from 'drizzle-orm';
import { getDbClient, items } from '../db';

export const STATES = [
  'pending',
  'extracted',
  'embedded',
  'scored',
  'dedup_done',
  'done',
  'failed',
] as const;
export type ItemState = (typeof STATES)[number];

// Per-item pipeline stages, in execution order. (ingest is per-source, handled separately.)
export const PER_ITEM_STAGES = ['extract', 'embed', 'score', 'dedup', 'summary'] as const;
export type PerItemStage = (typeof PER_ITEM_STAGES)[number];

// The state an item must already be in for a stage to run.
export const STAGE_REQUIRED_STATE = {
  extract: 'pending',
  embed: 'extracted',
  score: 'embedded',
  dedup: 'scored',
  summary: 'dedup_done',
} as const satisfies Record<PerItemStage, ItemState>;

// The state an item reaches when a stage succeeds.
export const STAGE_RESULT_STATE = {
  extract: 'extracted',
  embed: 'embedded',
  score: 'scored',
  dedup: 'dedup_done',
  summary: 'done',
} as const satisfies Record<PerItemStage, ItemState>;

// The stage to enqueue next after a stage succeeds (null = pipeline complete).
export const NEXT_STAGE: Record<PerItemStage, PerItemStage | null> = {
  extract: 'embed',
  embed: 'score',
  score: 'dedup',
  dedup: 'summary',
  summary: null,
};

/**
 * Mark the start of a stage attempt: set current_stage, bump attempts.
 * Returns the new attempts count (1 on first try).
 */
export async function beginStage(itemId: string, stage: PerItemStage): Promise<number> {
  const db = getDbClient();
  const rows = await db
    .update(items)
    .set({ currentStage: stage, attempts: sql`${items.attempts} + 1` })
    .where(eq(items.id, itemId))
    .returning({ attempts: items.attempts });
  return rows[0]?.attempts ?? 0;
}

/** Stage succeeded: advance state, point current_stage at the next stage, reset attempts/error. */
export async function completeStage(itemId: string, stage: PerItemStage): Promise<void> {
  const db = getDbClient();
  await db
    .update(items)
    .set({
      state: STAGE_RESULT_STATE[stage],
      currentStage: NEXT_STAGE[stage],
      attempts: 0,
      lastError: null,
    })
    .where(eq(items.id, itemId));
}

/** Stage threw: record the error only. State is intentionally NOT changed (retry-safe). */
export async function recordFailure(itemId: string, error: unknown): Promise<void> {
  const db = getDbClient();
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(items)
    .set({ lastError: message.slice(0, 2000) })
    .where(eq(items.id, itemId));
}

/** Terminal failure (called by the dead-letter handler after pg-boss exhausts retries). */
export async function markFailed(itemId: string, stage: PerItemStage): Promise<void> {
  const db = getDbClient();
  await db.update(items).set({ state: 'failed', currentStage: stage }).where(eq(items.id, itemId));
}
```

- [ ] **Step 4: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/pipeline/state.test.ts
```

Expected: PASS (3 tests). The DB mutators (`beginStage`/`completeStage`/`recordFailure`/`markFailed`) are exercised by the integration test in Phase M1a.10.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/state.ts packages/core/test/pipeline/state.test.ts
git commit -m "feat(core/pipeline): state-machine transition tables + DB mutators"
```

---

## Phase M1a.5 · Stages: ingest + extract

> **Testing note:** `ingest`/`extract`/`embed`/`score`/`dedup`/`summary` are IO-bound DB/network glue. Their pure sub-logic is unit-tested where it exists (Readability fetch, score prompt, state tables, config builders). The full happy path through all stages is driven by the **integration test in Phase M1a.10** (spec §13.2 treats full-pipeline as integration). Each stage function does **only its domain work** — it does **not** touch `items.state`; the queue runner (Phase M1a.9) owns `beginStage`/`completeStage`/`recordFailure` and enqueuing the next stage.

### Task 5: `ingestSource` (per-source: list new items, dedup, return inserted ids)

**Files:**
- Create: `packages/core/src/pipeline/ingest.ts`

- [ ] **Step 1: Implement `packages/core/src/pipeline/ingest.ts`**

```ts
import { eq } from 'drizzle-orm';
import { getDbClient, items, sources } from '../db';
import { getAdapter } from '../sources';
import { urlHash } from '../util/url';

export interface IngestResult {
  fetched: number;
  inserted: string[]; // ids of newly created items (need extract); excludes dedup hits
}

export async function ingestSource(sourceId: string): Promise<IngestResult> {
  const db = getDbClient();
  const srcRows = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  const source = srcRows[0];
  if (!source) throw new Error(`Source not found: ${sourceId}`);
  if (!source.enabled) return { fetched: 0, inserted: [] };

  const adapter = getAdapter(source.type);
  const raw = await adapter.fetchItems(source.config as Record<string, unknown>);

  const inserted: string[] = [];
  for (const r of raw) {
    // ON CONFLICT DO NOTHING (no target) covers BOTH unique constraints:
    // url_hash and the partial (source_id, external_id). A returning row means
    // it was genuinely new.
    const rows = await db
      .insert(items)
      .values({
        sourceId: source.id,
        externalId: r.externalId,
        url: r.url,
        urlHash: urlHash(r.url),
        title: r.title,
        author: r.author,
        publishedAt: r.publishedAt,
        contentType: 'article',
        rawContent: r.content, // may be null → extract will fetch + Readability
        state: 'pending',
        currentStage: 'extract',
      })
      .onConflictDoNothing()
      .returning({ id: items.id });
    if (rows[0]) inserted.push(rows[0].id);
  }

  await db.update(sources).set({ lastPolledAt: new Date() }).where(eq(sources.id, source.id));
  return { fetched: raw.length, inserted };
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @benkyou/core typecheck
```

Expected: PASS. (Behaviour verified by the Phase M1a.10 integration test.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/pipeline/ingest.ts
git commit -m "feat(core/pipeline): ingest stage (RSS list → dedup insert → inserted ids)"
```

---

### Task 6: `extractItem` (RSS full-text / Readability), with a `fetchReadable` unit test

**Files:**
- Create: `packages/core/src/pipeline/extract.ts`
- Test: `packages/core/test/pipeline/extract.test.ts`

- [ ] **Step 1: Write the failing test for the article-extraction helper (MSW)**

```ts
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchReadable } from '../../src/pipeline/extract.js';

const ARTICLE_HTML = `<!doctype html><html><head><title>T</title></head><body>
  <nav>menu junk</nav>
  <article><h1>Real Title</h1>
    <p>This is the first substantive paragraph of the real article body that Readability should keep.</p>
    <p>And a second paragraph with more meaningful content to clear the length threshold.</p>
  </article>
  <footer>footer junk</footer>
</body></html>`;

const server = setupServer(
  http.get('https://site.test/article', () =>
    new HttpResponse(ARTICLE_HTML, { headers: { 'content-type': 'text/html' } }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchReadable', () => {
  test('extracts main article text, dropping nav/footer', async () => {
    const text = await fetchReadable('https://site.test/article');
    expect(text).toContain('first substantive paragraph');
    expect(text).not.toContain('menu junk');
    expect(text).not.toContain('footer junk');
  });

  test('returns null on HTTP error (degrade, do not throw)', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 500 })));
    expect(await fetchReadable('https://site.test/article')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

```bash
pnpm --filter @benkyou/core exec vitest run test/pipeline/extract.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/pipeline/extract.ts`**

```ts
import { eq } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { getDbClient, items } from '../db';

// Below this many chars we assume the feed only gave us a blurb and fetch the
// real article. Article-fetch failures degrade (keep whatever we had) rather
// than failing the stage — spec §6.2: pipeline continues even without full text.
const FULLTEXT_MIN_CHARS = 600;

export async function fetchReadable(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'benkyou/0.1 (+readability)' } });
    if (!res.ok) return null;
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const text = article?.textContent?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export async function extractItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  let content = item.rawContent ?? '';
  if (content.length < FULLTEXT_MIN_CHARS && item.url) {
    const fetched = await fetchReadable(item.url);
    if (fetched && fetched.length > content.length) content = fetched;
  }

  await db
    .update(items)
    .set({ rawContent: content.length > 0 ? content : null, contentType: 'article' })
    .where(eq(items.id, itemId));
}
```

- [ ] **Step 4: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/pipeline/extract.test.ts
```

Expected: PASS (2 tests). If Readability returns less than expected, confirm `jsdom` parsed with the `url` option (Readability needs a document base URL).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/extract.ts packages/core/test/pipeline/extract.test.ts
git commit -m "feat(core/pipeline): extract stage with Readability fallback + degrade-on-error"
```

---

## Phase M1a.6 · Stage: embed

### Task 7: `embedItem` (write `item_embeddings`, guard embedding dim)

**Files:**
- Create: `packages/core/src/pipeline/embed.ts`

- [ ] **Step 1: Implement `packages/core/src/pipeline/embed.ts`**

```ts
import { eq } from 'drizzle-orm';
import { embed } from 'ai';
import { getDbClient, items, itemEmbeddings } from '../db';
import { env } from '../config/env';
import { resolveEmbedding } from '../ai';
import { buildEmbeddingConfig, getUserSettings } from '../settings';
import { truncateChars } from '../util/text';

const MAX_CONTENT_CHARS = 16_000; // ~4k tokens of body text (spec §6.2 embed)

export async function embedItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  const settings = await getUserSettings();
  if (!settings) throw new Error('user_settings not initialized');
  const cfg = buildEmbeddingConfig(settings);
  const model = resolveEmbedding(cfg);

  const body = truncateChars(item.rawContent, MAX_CONTENT_CHARS);
  const docText = body ? `${item.title}\n\n${body}` : item.title;

  const { embedding } = await embed({ model, value: docText });
  const { embedding: titleEmbedding } = await embed({ model, value: item.title });

  // Hard invariant: vector(N) is frozen at install time. A model whose output
  // dim != EMBED_DIM must fail loudly, not corrupt the table.
  if (embedding.length !== env.EMBED_DIM) {
    throw new Error(
      `Embedding dim mismatch: model '${cfg.model}' returned ${embedding.length}, schema expects ${env.EMBED_DIM}. ` +
        `Fix embed_model, or run scripts/migrate-embeddings.ts --new-dim=${embedding.length}.`,
    );
  }

  await db
    .insert(itemEmbeddings)
    .values({ itemId, embedding, titleEmb: titleEmbedding, modelId: cfg.model })
    .onConflictDoUpdate({
      target: itemEmbeddings.itemId,
      set: { embedding, titleEmb: titleEmbedding, modelId: cfg.model },
    });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @benkyou/core typecheck
```

Expected: PASS. If `embed`'s `value`/return type complains, confirm AI SDK v6 `embed({ model, value })` → `{ embedding: number[] }` and adjust the destructure. The `embedding: number[]` insert relies on the `vector` `customType` (`toDriver` turns it into `[a,b,...]`).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/pipeline/embed.ts
git commit -m "feat(core/pipeline): embed stage → item_embeddings with dim guard"
```

---

## Phase M1a.7 · Stages: score (LLM) + dedup (stub) + summary (LLM)

### Task 8: `scoreItem` — LLM topic/category, `depth_score` stub

**Files:**
- Create: `packages/core/src/pipeline/score.ts`
- Test: `packages/core/test/pipeline/score.test.ts`

- [ ] **Step 1: Write the failing test (pure: prompt + schema + stub constant)**

```ts
import { describe, expect, test } from 'vitest';
import { DEPTH_SCORE_STUB, buildScorePrompt, scoreSchema } from '../../src/pipeline/score.js';

describe('score stage pure logic', () => {
  test('depth score is the documented M1 stub value', () => {
    expect(DEPTH_SCORE_STUB).toBe(0.5);
  });

  test('prompt includes interests and title', () => {
    const p = buildScorePrompt({ title: 'New LLM released', content: 'body', interestTags: ['llm', 'agents'] });
    expect(p).toContain('New LLM released');
    expect(p).toContain('llm, agents');
  });

  test('schema accepts a valid object and rejects a bad category', () => {
    expect(scoreSchema.parse({ topic_tags: ['llm'], topic_score: 0.7, category: 'news' })).toEqual({
      topic_tags: ['llm'],
      topic_score: 0.7,
      category: 'news',
    });
    expect(() => scoreSchema.parse({ topic_tags: [], topic_score: 2, category: 'news' })).toThrow();
    expect(() => scoreSchema.parse({ topic_tags: [], topic_score: 0.5, category: 'other' })).toThrow();
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

```bash
pnpm --filter @benkyou/core exec vitest run test/pipeline/score.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/pipeline/score.ts`**

```ts
import { eq } from 'drizzle-orm';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getDbClient, items } from '../db';
import { resolveLLM } from '../ai';
import { buildLLMConfig, getUserSettings } from '../settings';
import { truncateChars } from '../util/text';

// M1: depth scoring is stubbed at a fixed midpoint. Real hype/news/tutorial/
// deep-dive scoring (B) lands in M3 (spec §15).
export const DEPTH_SCORE_STUB = 0.5;

export const scoreSchema = z.object({
  topic_tags: z.array(z.string()).max(8),
  topic_score: z.number().min(0).max(1),
  category: z.enum(['news', 'knowledge']),
});
export type ScoreResult = z.infer<typeof scoreSchema>;

export function buildScorePrompt(input: {
  title: string;
  content: string;
  interestTags: string[];
}): string {
  const interests = input.interestTags.length ? input.interestTags.join(', ') : '(none specified)';
  return [
    'You are scoring a piece of content for a personal AI-news reader.',
    `User interests: ${interests}`,
    '',
    `Title: ${input.title}`,
    'Content excerpt:',
    input.content || '(no body text available; judge from the title)',
    '',
    "Return topic_tags (normalized lowercase keywords), topic_score (0..1 relevance to the user's interests),",
    "and category: 'news' for hype/announcements, 'knowledge' for tutorials/deep-dives.",
  ].join('\n');
}

export async function scoreItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  const settings = await getUserSettings();
  if (!settings) throw new Error('user_settings not initialized');
  const cfg = buildLLMConfig(settings, { cheap: true });

  const prompt = buildScorePrompt({
    title: item.title,
    content: truncateChars(item.rawContent, 6000),
    interestTags: settings.interestTags ?? [],
  });

  const { object } = await generateObject({ model: resolveLLM(cfg), schema: scoreSchema, prompt });

  // numeric columns are strings in Drizzle's postgres-js driver.
  await db
    .update(items)
    .set({
      topicTags: object.topic_tags,
      topicScore: String(object.topic_score),
      depthScore: String(DEPTH_SCORE_STUB),
      category: object.category,
    })
    .where(eq(items.id, itemId));
}
```

- [ ] **Step 4: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/pipeline/score.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/score.ts packages/core/test/pipeline/score.test.ts
git commit -m "feat(core/pipeline): score stage (LLM topic/category) + depth_score stub"
```

---

### Task 9: `dedupItem` — M1 stub (always a fresh cluster)

**Files:**
- Create: `packages/core/src/pipeline/dedup.ts`

- [ ] **Step 1: Implement `packages/core/src/pipeline/dedup.ts`**

```ts
import { eq } from 'drizzle-orm';
import { eventClusters, getDbClient, items } from '../db';

// M1 STUB (spec §15): no similarity clustering yet. Every item becomes the
// canonical member of its own new cluster. Real title_emb cosine clustering
// lands in M3. The `state='dedup_done'` transition stays identical, so M3 only
// swaps the body of this function.
export async function dedupItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db
    .select({ topicTags: items.topicTags })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  const clusterRows = await db
    .insert(eventClusters)
    .values({ canonicalItem: itemId, keywords: item.topicTags ?? [], itemCount: 1 })
    .returning({ id: eventClusters.id });
  const clusterId = clusterRows[0]?.id;
  if (!clusterId) throw new Error('Failed to create event cluster');

  await db.update(items).set({ clusterId }).where(eq(items.id, itemId));
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @benkyou/core typecheck
git add packages/core/src/pipeline/dedup.ts
git commit -m "feat(core/pipeline): dedup stage stub (one cluster per item, M3 replaces body)"
```

---

### Task 10: `summarizeItem` — LLM 1–2 sentence summary

**Files:**
- Create: `packages/core/src/pipeline/summary.ts`

- [ ] **Step 1: Implement `packages/core/src/pipeline/summary.ts`**

```ts
import { eq } from 'drizzle-orm';
import { generateText } from 'ai';
import { getDbClient, items } from '../db';
import { resolveLLM } from '../ai';
import { buildLLMConfig, getUserSettings } from '../settings';
import { truncateChars } from '../util/text';

export async function summarizeItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  const settings = await getUserSettings();
  if (!settings) throw new Error('user_settings not initialized');
  const cfg = buildLLMConfig(settings, { cheap: true });
  const lang = settings.locale === 'en' ? 'English' : 'Chinese'; // spec §12: LLM output follows locale

  const prompt = [
    `Summarize the following article in 1-2 sentences, in ${lang}. Be concrete; no preamble, no "this article".`,
    '',
    `Title: ${item.title}`,
    truncateChars(item.rawContent, 6000) || '(no body text; summarize from the title)',
  ].join('\n');

  const { text } = await generateText({ model: resolveLLM(cfg), prompt });
  // Writing summary also refreshes the generated search_vec column automatically.
  await db.update(items).set({ summary: text.trim() }).where(eq(items.id, itemId));
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @benkyou/core typecheck
git add packages/core/src/pipeline/summary.ts
git commit -m "feat(core/pipeline): summary stage (locale-aware 1-2 sentence summary)"
```

---

## Phase M1a.8 · Pipeline barrel

### Task 11: `pipeline/index.ts` — `STAGE_HANDLERS` + re-exports

**Files:**
- Create: `packages/core/src/pipeline/index.ts`

- [ ] **Step 1: Implement `packages/core/src/pipeline/index.ts`**

```ts
import type { PerItemStage } from './state';
import { extractItem } from './extract';
import { embedItem } from './embed';
import { scoreItem } from './score';
import { dedupItem } from './dedup';
import { summarizeItem } from './summary';

export const STAGE_HANDLERS: Record<PerItemStage, (itemId: string) => Promise<void>> = {
  extract: extractItem,
  embed: embedItem,
  score: scoreItem,
  dedup: dedupItem,
  summary: summarizeItem,
};

export { ingestSource } from './ingest';
export type { IngestResult } from './ingest';
export * from './state';
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @benkyou/core typecheck
git add packages/core/src/pipeline/index.ts
git commit -m "feat(core/pipeline): barrel exporting STAGE_HANDLERS + state machine"
```

---

## Phase M1a.9 · Queue layer (registration, runner, drain, loop)

> **pg-boss v12 API used here (confirmed against M0's `boss.test.ts`):** `await boss.createQueue(name, options?)` before use; `boss.work(name, async ([job]) => {…})` (handler receives a batch array); `boss.send(name, data)`; `boss.fetch(name, { batchSize })`; `boss.complete(name, id)` / `boss.fail(name, id, data)`. Retry/dead-letter live in the per-queue `createQueue` options (the constructor no longer takes them — see M0 `boss.ts` comment). If a TS signature disagrees, fix the call site per the package types; do not downgrade pg-boss.

### Task 12: `queue/queues.ts` — names, registration, enqueue, due-source poll

**Files:**
- Create: `packages/core/src/queue/queues.ts`

- [ ] **Step 1: Implement `packages/core/src/queue/queues.ts`**

```ts
import type { PgBoss } from 'pg-boss';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getDbClient, sources } from '../db';
import { PER_ITEM_STAGES, type PerItemStage } from '../pipeline';

export const INGEST_QUEUE = 'ingest';
export const DEAD_LETTER_QUEUE = 'failed-items';

export interface StageJob {
  itemId: string;
  stage: PerItemStage;
}
export interface IngestJob {
  sourceId: string;
}

// pg-boss 12 sets retry/dead-letter policy per queue at creation; createQueue is
// idempotent so this is safe to call on every worker/batch startup.
export async function registerQueues(boss: PgBoss, maxAttempts: number): Promise<void> {
  await boss.createQueue(INGEST_QUEUE, { retryLimit: maxAttempts, retryBackoff: true });
  for (const stage of PER_ITEM_STAGES) {
    await boss.createQueue(stage, {
      retryLimit: maxAttempts,
      retryBackoff: true,
      deadLetter: DEAD_LETTER_QUEUE,
    });
  }
  await boss.createQueue(DEAD_LETTER_QUEUE);
}

export async function enqueueIngest(boss: PgBoss, sourceId: string): Promise<void> {
  await boss.send(INGEST_QUEUE, { sourceId } satisfies IngestJob);
}

export async function enqueueStage(
  boss: PgBoss,
  stage: PerItemStage,
  itemId: string,
): Promise<void> {
  // stage is carried in the payload so the single dead-letter handler knows
  // which stage to record on terminal failure.
  await boss.send(stage, { itemId, stage } satisfies StageJob);
}

// Enqueue an ingest job for every enabled source whose poll_interval has elapsed.
export async function checkDueSources(boss: PgBoss): Promise<number> {
  const db = getDbClient();
  const due = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.enabled, true),
        or(
          isNull(sources.lastPolledAt),
          lte(
            sql`${sources.lastPolledAt} + make_interval(secs => ${sources.pollInterval})`,
            sql`now()`,
          ),
        ),
      ),
    );
  for (const s of due) await enqueueIngest(boss, s.id);
  return due.length;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @benkyou/core typecheck
git add packages/core/src/queue/queues.ts
git commit -m "feat(core/queue): queue names, registration, enqueue helpers, due-source poll"
```

---

### Task 13: `queue/runner.ts` — one stage attempt (begin → work → advance/fail)

This is where the state-machine invariant is enforced for every retry.

**Files:**
- Create: `packages/core/src/queue/runner.ts`

- [ ] **Step 1: Implement `packages/core/src/queue/runner.ts`**

```ts
import type { PgBoss } from 'pg-boss';
import { STAGE_HANDLERS } from '../pipeline';
import { NEXT_STAGE, beginStage, completeStage, markFailed, recordFailure } from '../pipeline/state';
import { ingestSource } from '../pipeline/ingest';
import { enqueueStage, type IngestJob, type StageJob } from './queues';

export async function runItemStage(boss: PgBoss, job: StageJob): Promise<void> {
  const { itemId, stage } = job;
  await beginStage(itemId, stage); // current_stage = stage, attempts++
  try {
    await STAGE_HANDLERS[stage](itemId);
  } catch (err) {
    await recordFailure(itemId, err); // last_error only; state untouched
    throw err; // pg-boss retries with backoff; after retryLimit → dead-letter
  }
  await completeStage(itemId, stage); // state → next, attempts = 0
  const next = NEXT_STAGE[stage];
  if (next) await enqueueStage(boss, next, itemId);
}

export async function runIngest(boss: PgBoss, job: IngestJob): Promise<number> {
  const { inserted } = await ingestSource(job.sourceId);
  for (const id of inserted) await enqueueStage(boss, 'extract', id);
  return inserted.length;
}

// Dead-letter handler = the spec's "onFail" callback: terminal failure.
export async function handleDeadLetter(job: StageJob): Promise<void> {
  await markFailed(job.itemId, job.stage);
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @benkyou/core typecheck
git add packages/core/src/queue/runner.ts
git commit -m "feat(core/queue): stage runner enforcing state machine + dead-letter onFail"
```

---

### Task 14: `queue/batch.ts` (serverless drain) + `queue/loop.ts` (docker loop) + barrel

**Files:**
- Create: `packages/core/src/queue/batch.ts`, `packages/core/src/queue/loop.ts`, `packages/core/src/queue/index.ts`
- Modify: `packages/core/package.json` (exports map)

- [ ] **Step 1: Implement `packages/core/src/queue/batch.ts`**

```ts
import { getBoss } from './boss';
import { getUserSettings } from '../settings';
import { PER_ITEM_STAGES } from '../pipeline';
import {
  DEAD_LETTER_QUEUE,
  INGEST_QUEUE,
  checkDueSources,
  registerQueues,
  type IngestJob,
  type StageJob,
} from './queues';
import { handleDeadLetter, runIngest, runItemStage } from './runner';

export interface BatchResult {
  processed: number;
  errors: number;
}

// Serverless trigger (DEPLOY_MODE=serverless, called by /api/cron/work). Draining
// queues in pipeline order lets a brand-new item cascade pending → done within a
// single invocation.
export async function processBatch(maxJobs: number): Promise<BatchResult> {
  const boss = await getBoss();
  const settings = await getUserSettings();
  await registerQueues(boss, settings?.pipelineMaxAttempts ?? 3);
  await checkDueSources(boss);

  const queues = [INGEST_QUEUE, ...PER_ITEM_STAGES, DEAD_LETTER_QUEUE] as const;
  let processed = 0;
  let errors = 0;

  for (const queue of queues) {
    while (processed < maxJobs) {
      const jobs = await boss.fetch(queue, { batchSize: Math.min(5, maxJobs - processed) });
      if (!jobs || jobs.length === 0) break;
      for (const job of jobs) {
        try {
          if (queue === INGEST_QUEUE) await runIngest(boss, job.data as IngestJob);
          else if (queue === DEAD_LETTER_QUEUE) await handleDeadLetter(job.data as StageJob);
          else await runItemStage(boss, job.data as StageJob);
          await boss.complete(queue, job.id);
        } catch (err) {
          errors += 1;
          await boss.fail(queue, job.id, {
            message: err instanceof Error ? err.message : String(err),
          });
        }
        processed += 1;
        if (processed >= maxJobs) break;
      }
    }
    if (processed >= maxJobs) break;
  }

  return { processed, errors };
}
```

- [ ] **Step 2: Implement `packages/core/src/queue/loop.ts`**

```ts
import { getBoss } from './boss';
import { getUserSettings } from '../settings';
import { PER_ITEM_STAGES } from '../pipeline';
import {
  DEAD_LETTER_QUEUE,
  INGEST_QUEUE,
  checkDueSources,
  registerQueues,
  type IngestJob,
  type StageJob,
} from './queues';
import { handleDeadLetter, runIngest, runItemStage } from './runner';

const DUE_SOURCE_POLL_MS = 60_000;

// Long-running worker (DEPLOY_MODE=docker). Registers a worker per queue and
// polls for due sources. Resolves only on SIGTERM/SIGINT.
export async function runWorkerLoop(): Promise<void> {
  const boss = await getBoss();
  const settings = await getUserSettings();
  await registerQueues(boss, settings?.pipelineMaxAttempts ?? 3);

  await boss.work<IngestJob>(INGEST_QUEUE, async ([job]) => {
    if (job) await runIngest(boss, job.data);
  });
  for (const stage of PER_ITEM_STAGES) {
    await boss.work<StageJob>(stage, async ([job]) => {
      if (job) await runItemStage(boss, job.data);
    });
  }
  await boss.work<StageJob>(DEAD_LETTER_QUEUE, async ([job]) => {
    if (job) await handleDeadLetter(job.data);
  });

  await checkDueSources(boss);
  const timer = setInterval(() => void checkDueSources(boss), DUE_SOURCE_POLL_MS);
  console.log('[worker] pipeline started: queues registered, due-source poller active');

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      clearInterval(timer);
      resolve();
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  });
}
```

- [ ] **Step 3: Implement `packages/core/src/queue/index.ts` (barrel)**

```ts
export { getBoss, closeBoss } from './boss';
export * from './queues';
export * from './runner';
export { runWorkerLoop } from './loop';
export { processBatch, type BatchResult } from './batch';
```

- [ ] **Step 4: Update `packages/core/package.json` `exports` map**

Replace the `exports` object with (note `./queue` now points at the barrel, plus three new subpaths):

```json
"exports": {
  ".": "./src/index.ts",
  "./db": "./src/db/index.ts",
  "./ai": "./src/ai/index.ts",
  "./queue": "./src/queue/index.ts",
  "./pipeline": "./src/pipeline/index.ts",
  "./settings": "./src/settings/index.ts",
  "./sources": "./src/sources/index.ts",
  "./config": "./src/config/env.ts"
},
```

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @benkyou/core typecheck
git add packages/core/src/queue packages/core/package.json
git commit -m "feat(core/queue): serverless batch drain, docker loop, barrel + exports"
```

---

## Phase M1a.10 · Wire the worker entrypoints + full-pipeline integration test

### Task 15: Replace worker stubs with re-exports of the core implementations

The worker app is now a pure entrypoint: it owns `assertEnv()` + mode dispatch (already in `index.ts`), and delegates all logic to `@benkyou/core/queue`.

**Files:**
- Modify: `apps/worker/src/loop.ts`, `apps/worker/src/batch.ts`

- [ ] **Step 1: Replace `apps/worker/src/loop.ts` entirely**

```ts
// Worker long-running mode delegates to the shared implementation in core.
export { runWorkerLoop as runLoop } from '@benkyou/core/queue';
```

- [ ] **Step 2: Replace `apps/worker/src/batch.ts` entirely**

```ts
// Serverless batch handler delegates to the shared implementation in core.
// (/api/cron/work in apps/web calls the same core processBatch in M1b.)
export { processBatch, type BatchResult } from '@benkyou/core/queue';
```

`apps/worker/src/index.ts` is unchanged: it already does `assertEnv()` then `const { runLoop } = await import('./loop.js')` for docker mode. `runLoop` is now the real loop.

- [ ] **Step 3: Typecheck the worker**

```bash
pnpm --filter @benkyou/worker typecheck
```

Expected: PASS. (`apps/worker/vitest.config.ts` keeps `passWithNoTests: true` — the worker has no logic of its own to test; the logic lives in core and is covered there.)

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/loop.ts apps/worker/src/batch.ts
git commit -m "feat(worker): delegate loop + batch to @benkyou/core/queue"
```

---

### Task 16: Full-pipeline integration test (this is M1a's definition of done)

**Files:**
- Create: `packages/core/test/pipeline/pipeline.int.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import postgres from 'postgres';

// No real AI provider: stub the three AI SDK calls the stages make. The mock is
// hoisted, so the dynamically-imported stages below pick it up.
vi.mock('ai', () => ({
  embed: vi.fn(async () => ({ embedding: Array.from({ length: 1536 }, () => 0.01) })),
  generateObject: vi.fn(async () => ({
    object: { topic_tags: ['llm'], topic_score: 0.8, category: 'knowledge' },
  })),
  generateText: vi.fn(async () => ({ text: 'A concise one-sentence summary.' })),
}));

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel><title>AI Feed</title>
    <item>
      <title>A New Model</title>
      <link>https://news.test/a-new-model</link>
      <guid>nm-1</guid>
      <pubDate>Wed, 28 May 2026 10:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>${'Substantive article body. '.repeat(60)}</p>]]></content:encoded>
    </item>
  </channel></rss>`;

const server = setupServer(
  http.get('https://news.test/rss', () =>
    new HttpResponse(FEED, { headers: { 'content-type': 'application/rss+xml' } }),
  ),
);

describe('full pipeline: pending → done', () => {
  let container: StartedTestContainer;
  let sql: postgres.Sql;
  let processBatch: (n: number) => Promise<{ processed: number; errors: number }>;
  let closeBoss: () => Promise<void>;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    server.listen({ onUnhandledRequest: 'bypass' });
    container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();

    const url = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
    // Set env BEFORE importing any core module (env.ts reads process.env at load).
    process.env.DATABASE_URL = url;
    process.env.EMBED_DIM = '1536';
    process.env.SESSION_SECRET = 'a'.repeat(40);
    process.env.DEPLOY_MODE = 'serverless';

    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations(url);

    sql = postgres(url);
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, locale, llm_provider, llm_model, llm_cheap_model, embed_provider, embed_model, interest_tags)
      VALUES (1, 'x', 1536, 'en', 'openai', 'gpt-x', 'gpt-x-mini', 'openai', 'emb-x', ARRAY['llm'])`;
    await sql`INSERT INTO sources (type, name, config)
      VALUES ('rss', 'AI Feed', ${sql.json({ url: 'https://news.test/rss' })})`;

    ({ processBatch } = await import('../../src/queue/batch.js'));
    ({ closeBoss } = await import('../../src/queue/boss.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeBoss?.();
    await closeDbClient?.();
    await sql?.end();
    await container?.stop();
    server.close();
  });

  test('one RSS item flows through every stage to done', async () => {
    // Pipeline-ordered drain → a single call cascades the new item to done.
    const result = await processBatch(50);
    expect(result.errors).toBe(0);
    expect(result.processed).toBeGreaterThan(0);

    const rows = await sql<
      {
        state: string;
        summary: string | null;
        topic_score: string | null;
        depth_score: string | null;
        category: string | null;
        cluster_id: string | null;
        raw_content: string | null;
      }[]
    >`SELECT state, summary, topic_score, depth_score, category, cluster_id, raw_content FROM items`;
    expect(rows).toHaveLength(1);
    const item = rows[0]!;

    expect(item.state).toBe('done');
    expect(item.summary).toBe('A concise one-sentence summary.');
    expect(Number(item.topic_score)).toBe(0.8);
    expect(Number(item.depth_score)).toBe(0.5); // M1 stub
    expect(item.category).toBe('knowledge');
    expect(item.cluster_id).not.toBeNull();
    expect(item.raw_content).toContain('Substantive article body');

    const emb = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM item_embeddings`;
    expect(emb[0]!.n).toBe(1);

    // search_vec is generated from title+summary+raw_content → now populated.
    const sv = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM items
      WHERE search_vec @@ plainto_tsquery('simple', 'model')`;
    expect(sv[0]!.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run it; confirm it passes**

```bash
pnpm --filter @benkyou/core exec vitest run test/pipeline/pipeline.int.test.ts
```

Expected: PASS. First run pulls the `pgvector/pgvector:pg16` image (~30–60s). If the `extract` stage tries to hit the network because the feed body was under the threshold, raise the `content:encoded` length in `FEED` or set `onUnhandledRequest: 'bypass'` (already set).

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/pipeline/pipeline.int.test.ts
git commit -m "test(core/pipeline): integration — one RSS item → done with summary/embedding/score"
```

---

## Phase M1a.11 · Verify M1a green

### Task 17: Run the full gate + a manual live smoke (optional)

- [ ] **Step 1: Run the whole CI gate locally**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm test
```

Expected: all green. The new core suites (`url`, `rss`, `settings/config`, `pipeline/state`, `pipeline/extract`, `pipeline/score`, `pipeline/pipeline.int`) run under `pnpm test`.

- [ ] **Step 2 (optional, real providers): live smoke against a running DB + real LLM/embeddings**

Per `docs/dev/env-and-monorepo.md`, host-run processes override the DB host inline (the `.env` host `postgres` only resolves inside compose):

```bash
docker compose up -d postgres
DATABASE_URL=postgres://benkyou:benkyou@localhost:5432/benkyou pnpm migrate

# Seed a settings row + one RSS source via psql (real LLM/embeddings configured):
docker compose exec -T postgres psql -U benkyou -d benkyou <<'SQL'
INSERT INTO user_settings (id, password_hash, embed_dim, locale,
  llm_provider, llm_model, llm_cheap_model, embed_provider, embed_model)
VALUES (1, 'placeholder', 1536, 'zh',
  'openai', 'gpt-4.1', 'gpt-4.1-mini', 'openai', 'text-embedding-3-small')
ON CONFLICT (id) DO NOTHING;
INSERT INTO sources (type, name, config)
VALUES ('rss', 'Simon Willison', '{"url":"https://simonwillison.net/atom/everything/"}');
SQL

# Run the worker once in serverless drain mode (reuses processBatch):
DATABASE_URL=postgres://benkyou:benkyou@localhost:5432/benkyou \
DEPLOY_MODE=serverless \
pnpm --filter @benkyou/core exec tsx -e "import {processBatch} from './src/queue/batch.ts'; processBatch(50).then(r=>{console.log(r); process.exit(0)})"

# Inspect results:
docker compose exec -T postgres psql -U benkyou -d benkyou \
  -c "SELECT state, left(summary,60), topic_score, category FROM items;"
```

Expected: at least one row in `state='done'` with a non-empty `summary`. Note `EMBED_DIM` must match your real embedding model's output dim (e.g. `text-embedding-3-small` = 1536) or the embed stage throws the dim-guard error by design.

- [ ] **Step 3: Tear down**

```bash
docker compose down
```

---

## M1a self-review (planner)

**Spec coverage (§6 pipeline):**

| Spec item | Where |
|---|---|
| §6.1 6-stage state machine, retry-safe (state unchanged on failure) | Task 4 (`state.ts`) + Task 13 (`runner.ts`) |
| §6.1 `onFail` → `state='failed'` after `pipeline_max_attempts` | dead-letter queue (Task 12 + Task 13 `handleDeadLetter`) |
| §6.2 ingest (list + dedup via unique constraints) | Task 5 |
| §6.2 extract (RSS `content:encoded`; else Readability) | Task 6 |
| §6.2 embed (title + truncated body; separate `title_emb`) | Task 7 |
| §6.2 score (LLM topic_tags/topic_score/category; **D not baked in**) | Task 8 |
| §15 `depth_score` = 0.5 stub | Task 8 (`DEPTH_SCORE_STUB`) |
| §6.2 dedup; §15 dedup = always-new-cluster stub | Task 9 |
| §6.2 summary (cheap model, all items, locale-aware) | Task 10 |
| §11.2 two worker modes, same handlers | Task 14 (`loop.ts` + `batch.ts`) + Task 15 |
| §2 provider abstraction (no hard-coded providers) | all AI stages go through `@benkyou/core/ai` |
| Hard invariant: embedding dim frozen | Task 7 dim guard |

**Deferred by design (not M1a):** video/transcribe stages + `transcript_status` branches (M2); real depth scoring + real dedup clustering + digest (M3); `/admin/jobs` retry UI (M3). The state machine shape is final, so those are body-swaps, not schema/flow changes.

**Placeholder scan:** none — every task ships runnable code. **Type consistency:** `StageJob`/`IngestJob`, `PerItemStage`, `STAGE_HANDLERS`, `runItemStage`/`runIngest`/`handleDeadLetter`, `processBatch`/`runWorkerLoop` names are consistent across queues/runner/batch/loop/worker and the integration test.

---

## ➡️ Next: M1b

M1a leaves the system able to *produce* `state='done'` items but with **no way for a human to configure it or see the output**. Continue with **`docs/superpowers/plans/2026-05-31-benkyou-m1b-product.md`**: minimal auth, the `/setup` flow (which writes the `user_settings` row this pipeline depends on + adds the first RSS source + triggers the first fetch), the home feed, item detail + lazy deep-summary, and full hybrid search. M1b's first manual smoke is literally "complete setup, wait ~2 min, see the item M1a produced on the home page."

The execution-mode handoff (subagent-driven vs inline) is at the end of M1b so both sub-plans are chosen together.

