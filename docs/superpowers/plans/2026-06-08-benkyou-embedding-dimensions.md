# Per-request Embedding Dimensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in toggle that sends a per-request output-dimension parameter to the embedding provider, so a high-native-dim MRL model (e.g. `text-embedding-3-large`=3072, `gemini-embedding-001`=3072) emits exactly `EMBED_DIM` dims — keeping `vector(1536)` and avoiding `halfvec`.

**Architecture:** A new `user_settings.embed_request_dimensions` boolean (default false, UI-editable). When true, `buildEmbeddingConfig` derives `dimensions = embed_dim` (single source of truth) onto `EmbeddingConfig`; a pure `embeddingProviderOptions(cfg)` maps that to the provider-specific call-time `providerOptions` key (`openai.dimensions`, `google.outputDimensionality`, `openaiCompatible.dimensions`); both the embed pipeline stage and the setup/settings connectivity test pass it. `embed_dim` itself stays frozen and read-only.

**Tech Stack:** TypeScript (strict, ESM `.js` import specifiers), Drizzle ORM 0.45+ / pgvector, Vercel AI SDK 6 (`ai` + `@ai-sdk/*`), Zod 4, Vitest 4 (+ Testcontainers for `.int` tests), Next.js 16 App Router, next-intl 4.

**Spec:** [`docs/superpowers/specs/2026-06-08-benkyou-embedding-dimensions-design.md`](../specs/2026-06-08-benkyou-embedding-dimensions-design.md)

**Working directory:** `.claude/worktrees/m1b-product` (branch `worktree-m1b-product`). All paths below are relative to the repo root of that worktree.

**Conventions reminder (from `CLAUDE.md`):** TypeScript strict, no `any`, named exports only, tests import core modules with `.js` specifiers (e.g. `../src/ai/provider.js`), conventional-commit prefixes, every user-visible string goes through next-intl (CI runs `pnpm check:i18n`).

---

## File Structure

**`packages/core` (business logic — all the real logic lives here):**
- `src/db/schema.ts` — add `embedRequestDimensions` column (Task 1)
- `src/db/migrations/0002_*.sql` + `meta/` — generated migration (Task 1)
- `src/config/env.ts` — `DEFAULT_EMBED_REQUEST_DIMENSIONS` seed var (Task 2)
- `src/ai/provider.ts` — `EmbeddingConfig.dimensions` + `embeddingProviderOptions()` (Task 3)
- `src/settings/index.ts` — derive `dimensions`, extend `SettingsPatch` (Task 4)
- `src/pipeline/embed.ts` — pass `providerOptions` to `embedMany`, improve error (Task 5)
- `src/setup/index.ts` — `testEmbedding` passes `providerOptions`; `completeSetup` persists; `SetupInput` type (Task 6)

**`packages/core/test`:**
- `env.test.ts` (Task 2), `ai.test.ts` (Task 3), `settings/config.test.ts` (Task 4), `pipeline/pipeline.int.test.ts` (Task 5), `setup/test-embedding.test.ts` new + `setup/setup.int.test.ts` (Task 6)

**`apps/web` (thin UI layer):**
- `messages/zh.json`, `messages/en.json` (Task 7)
- `app/setup/SetupForm.tsx`, `app/setup/page.tsx`, `app/setup/actions.ts` (Task 8)
- `app/(authed)/settings/SettingsForm.tsx`, `app/(authed)/settings/actions.ts` (Task 9)

**`docs`:**
- master spec + `CLAUDE.md` (Task 10)

---

## Task 1: Add `embed_request_dimensions` column + migration

Schema/migration is a setup task — no TDD (per `CLAUDE.md`). The column is additive with `DEFAULT false`, so the existing single `user_settings` row backfills safely. **`item_embeddings` / `vector(N)` is untouched — no re-embed.**

**Files:**
- Modify: `packages/core/src/db/schema.ts` (in the `user_settings` table, near `embedDim`)
- Create (generated): `packages/core/src/db/migrations/0002_*.sql`, `packages/core/src/db/migrations/meta/0002_snapshot.json`, updated `meta/_journal.json`

- [ ] **Step 1: Add the column to the Drizzle schema**

In `packages/core/src/db/schema.ts`, the `user_settings` table already imports `boolean` from `drizzle-orm/pg-core` (used by `items.bookmarked`). Add the new column right after the `embedDim` line:

```ts
  embedModel: text('embed_model'),
  embedDim: integer('embed_dim').notNull(),
  embedRequestDimensions: boolean('embed_request_dimensions').notNull().default(false),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @benkyou/core exec drizzle-kit generate`
Expected: a new `src/db/migrations/0002_<random>.sql` is created, plus `meta/0002_snapshot.json` and an updated `meta/_journal.json`.

- [ ] **Step 3: Review the generated SQL**

Run: `cat packages/core/src/db/migrations/0002_*.sql`
Expected — exactly one additive statement, nothing touching `item_embeddings`:

```sql
ALTER TABLE "user_settings" ADD COLUMN "embed_request_dimensions" boolean DEFAULT false NOT NULL;
```

If the generated SQL drops/recreates anything else, stop and investigate — the schema diff was wrong.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @benkyou/core typecheck`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/migrations/
git commit -m "feat(core/db): add user_settings.embed_request_dimensions column"
```

---

## Task 2: Add `DEFAULT_EMBED_REQUEST_DIMENSIONS` seed env var

Lets fresh/headless installs default the toggle on. Uses a strict `'true' | 'false'` enum — **not** `z.coerce.boolean()`, which would turn the string `"false"` into `true`.

**Files:**
- Modify: `packages/core/src/config/env.ts`
- Test: `packages/core/test/env.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('env config', ...)` block in `packages/core/test/env.test.ts`:

```ts
  test('DEFAULT_EMBED_REQUEST_DIMENSIONS parses "false" as false, not truthy', async () => {
    vi.resetModules();
    vi.stubEnv('DEPLOY_MODE', 'docker');
    vi.stubEnv('DATABASE_URL', 'postgres://x/y');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(32));
    vi.stubEnv('EMBED_DIM', '1536');
    vi.stubEnv('DEFAULT_EMBED_REQUEST_DIMENSIONS', 'false');
    const { env } = await import('../src/config/env.js');
    expect(env.DEFAULT_EMBED_REQUEST_DIMENSIONS).toBe(false);
    vi.unstubAllEnvs();
  });

  test('DEFAULT_EMBED_REQUEST_DIMENSIONS parses "true" as true', async () => {
    vi.resetModules();
    vi.stubEnv('DEPLOY_MODE', 'docker');
    vi.stubEnv('DATABASE_URL', 'postgres://x/y');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(32));
    vi.stubEnv('EMBED_DIM', '1536');
    vi.stubEnv('DEFAULT_EMBED_REQUEST_DIMENSIONS', 'true');
    const { env } = await import('../src/config/env.js');
    expect(env.DEFAULT_EMBED_REQUEST_DIMENSIONS).toBe(true);
    vi.unstubAllEnvs();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/env.test.ts`
Expected: FAIL — the new property is `undefined` (the schema field doesn't exist yet).

- [ ] **Step 3: Add the field to the schema**

In `packages/core/src/config/env.ts`, add this line inside the `z.object({ ... })` `Schema`, just after the `DEFAULT_EMBED_MODEL` line:

```ts
  DEFAULT_EMBED_MODEL: z.string().optional(),
  DEFAULT_EMBED_REQUEST_DIMENSIONS: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/env.ts packages/core/test/env.test.ts
git commit -m "feat(core/config): DEFAULT_EMBED_REQUEST_DIMENSIONS seed env (strict bool parse)"
```

---

## Task 3: `embeddingProviderOptions()` + `EmbeddingConfig.dimensions`

The pure mapping from a requested dimension to the provider-specific call-time `providerOptions`. This is where the real bug risk lives (the `openaiCompatible` camelCase key), so it gets thorough unit tests.

**Files:**
- Modify: `packages/core/src/ai/provider.ts`
- Test: `packages/core/test/ai.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the top imports of `packages/core/test/ai.test.ts`:

```ts
import { resolveLLM, resolveEmbedding, embeddingProviderOptions } from '../src/ai/provider.js';
```

(Replace the existing `import { resolveLLM, resolveEmbedding } from '../src/ai/provider.js';` line.)

Then add a new `describe` block at the end of the file:

```ts
describe('embeddingProviderOptions', () => {
  test('returns undefined when no dimensions requested', () => {
    expect(embeddingProviderOptions({ provider: 'openai', model: 'm' })).toBeUndefined();
  });

  test('openai → { openai: { dimensions } }', () => {
    expect(embeddingProviderOptions({ provider: 'openai', model: 'm', dimensions: 1536 })).toEqual({
      openai: { dimensions: 1536 },
    });
  });

  test('google → { google: { outputDimensionality } }', () => {
    expect(embeddingProviderOptions({ provider: 'google', model: 'm', dimensions: 1536 })).toEqual({
      google: { outputDimensionality: 1536 },
    });
  });

  test('openai-compatible → { openaiCompatible: { dimensions } } (non-deprecated camelCase key)', () => {
    expect(
      embeddingProviderOptions({ provider: 'openai-compatible', baseUrl: 'http://x', model: 'm', dimensions: 1536 }),
    ).toEqual({ openaiCompatible: { dimensions: 1536 } });
  });

  test('ollama → { openaiCompatible: { dimensions } } (same code path as openai-compatible)', () => {
    expect(
      embeddingProviderOptions({ provider: 'ollama', baseUrl: 'http://x', model: 'm', dimensions: 1536 }),
    ).toEqual({ openaiCompatible: { dimensions: 1536 } });
  });

  test('throws for a provider that cannot take a dimensions request', () => {
    expect(() => embeddingProviderOptions({ provider: 'unknown', model: 'm', dimensions: 1536 })).toThrow(
      /does not support dimensions/i,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @benkyou/core exec vitest run test/ai.test.ts`
Expected: FAIL — `embeddingProviderOptions is not a function` / not exported.

- [ ] **Step 3: Implement in `provider.ts`**

In `packages/core/src/ai/provider.ts`, change the `EmbeddingConfig` type from an alias to an interface that adds `dimensions`. Replace:

```ts
export type LLMConfig = ProviderConfig;
export type EmbeddingConfig = ProviderConfig;
```

with:

```ts
export type LLMConfig = ProviderConfig;
export interface EmbeddingConfig extends ProviderConfig {
  // When set, ask the model to emit exactly this many dims (Matryoshka truncation).
  // Always equals user_settings.embed_dim — the vector(N) column is frozen.
  dimensions?: number;
}
```

Then add this function at the end of the file (after `resolveEmbedding`):

```ts
// Per-request output-dimension parameter. Provider key names differ:
//   openai             → openai.dimensions
//   google             → google.outputDimensionality
//   openai-compatible  → openaiCompatible.dimensions  (camelCase; the raw 'openai-compatible'
//   ollama               key is deprecated in @ai-sdk/openai-compatible and warns at runtime.
//                          The camelCase key is read unconditionally for both names.)
// Re-verify the openaiCompatible key if @ai-sdk/openai-compatible is upgraded past 2.0.48.
export function embeddingProviderOptions(
  cfg: EmbeddingConfig,
): Record<string, Record<string, number>> | undefined {
  if (cfg.dimensions == null) return undefined;
  switch (cfg.provider) {
    case 'openai':
      return { openai: { dimensions: cfg.dimensions } };
    case 'google':
      return { google: { outputDimensionality: cfg.dimensions } };
    case 'openai-compatible':
    case 'ollama':
      return { openaiCompatible: { dimensions: cfg.dimensions } };
    default:
      throw new Error(`Embedding provider does not support dimensions request: ${cfg.provider}`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @benkyou/core exec vitest run test/ai.test.ts`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ai/provider.ts packages/core/test/ai.test.ts
git commit -m "feat(core/ai): embeddingProviderOptions maps requested dim to provider key"
```

---

## Task 4: Derive `dimensions` in `buildEmbeddingConfig` + extend `SettingsPatch`

`buildEmbeddingConfig` turns the stored boolean into the requested dimension (= `embed_dim`). `SettingsPatch` gains the field so the settings action can persist it.

**Files:**
- Modify: `packages/core/src/settings/index.ts`
- Test: `packages/core/test/settings/config.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/settings/config.test.ts`, add two tests inside the existing `describe('buildEmbeddingConfig', ...)` block:

```ts
  test('derives dimensions from embedDim when embedRequestDimensions is true', () => {
    const s = settings({
      embedProvider: 'openai',
      embedModel: 'text-embedding-3-large',
      embedBaseUrl: null,
      embedApiKey: 'k',
      embedDim: 1536,
      embedRequestDimensions: true,
    });
    expect(buildEmbeddingConfig(s).dimensions).toBe(1536);
  });

  test('leaves dimensions undefined when embedRequestDimensions is false', () => {
    const s = settings({
      embedProvider: 'openai',
      embedModel: 'text-embedding-3-small',
      embedBaseUrl: null,
      embedApiKey: 'k',
      embedDim: 1536,
      embedRequestDimensions: false,
    });
    expect(buildEmbeddingConfig(s).dimensions).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @benkyou/core exec vitest run test/settings/config.test.ts`
Expected: FAIL — `.dimensions` is `undefined` in the true-case (derivation not implemented).

- [ ] **Step 3: Implement the derivation**

In `packages/core/src/settings/index.ts`, update `buildEmbeddingConfig`'s return object to add the `dimensions` line:

```ts
  return {
    provider: s.embedProvider,
    baseUrl: s.embedBaseUrl ?? undefined,
    apiKey: s.embedApiKey ?? undefined,
    model: s.embedModel,
    dimensions: s.embedRequestDimensions ? s.embedDim : undefined,
  };
```

Then add the field to `SettingsPatch` (after `embedModel?: string;`):

```ts
  embedModel?: string;
  embedRequestDimensions?: boolean;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @benkyou/core exec vitest run test/settings/config.test.ts`
Expected: PASS (including the pre-existing `maps embed_* fields` test — Vitest `toEqual` ignores the new `dimensions: undefined` property).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/settings/index.ts packages/core/test/settings/config.test.ts
git commit -m "feat(core/settings): derive embedding dimensions from frozen embed_dim"
```

---

## Task 5: Pass `providerOptions` from the embed pipeline stage

Wire the pipeline stage to actually send the parameter, and sharpen the dim-mismatch error to point at the toggle. Threading is proven by an integration assertion (the mapping/derivation logic is already unit-covered in Tasks 3–4).

**Files:**
- Modify: `packages/core/src/pipeline/embed.ts`
- Test: `packages/core/test/pipeline/pipeline.int.test.ts`

- [ ] **Step 1: Write the failing integration test**

In `packages/core/test/pipeline/pipeline.int.test.ts`, add a new `test()` **inside the existing `describe('full pipeline: pending → done', ...)` block, after the existing test(s)** (it reuses the container/`sql` from `beforeAll`):

```ts
  test('embed stage forwards dimensions providerOptions when the toggle is on', async () => {
    const { embedMany } = await import('ai');
    const { embedItem } = await import('../../src/pipeline/embed.js');

    await sql`UPDATE user_settings SET embed_request_dimensions = true WHERE id = 1`;
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, raw_content, state)
      VALUES ('https://news.test/dim-1', 'dim-hash-1', 'Dim Test', 'article', 'body text', 'extracted')
      RETURNING id`;
    const itemId = inserted[0]!.id;

    vi.mocked(embedMany).mockClear();
    await embedItem(itemId);

    expect(vi.mocked(embedMany)).toHaveBeenCalledWith(
      expect.objectContaining({ providerOptions: { openai: { dimensions: 1536 } } }),
    );

    // Restore for any later tests / cross-test isolation.
    await sql`UPDATE user_settings SET embed_request_dimensions = false WHERE id = 1`;
  });
```

(The `beforeAll` seed sets `embed_provider = 'openai'` and `embed_dim = 1536`, so the expected key is `openai.dimensions = 1536`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/pipeline/pipeline.int.test.ts`
Expected: FAIL — `embedMany` was called **without** `providerOptions` (the stage doesn't pass it yet). (Requires Docker for Testcontainers; first run pulls `pgvector/pgvector:pg16`.)

- [ ] **Step 3: Implement in `embed.ts`**

In `packages/core/src/pipeline/embed.ts`:

a) Add `embeddingProviderOptions` to the `../ai` import:

```ts
import { resolveEmbedding, embeddingProviderOptions } from '../ai';
```

b) Pass `providerOptions` to `embedMany`. Replace the existing call:

```ts
  // One round-trip for both vectors. Order matches values: [doc, title].
  const { embeddings } = await embedMany({
    model,
    values: [docText, item.title],
    providerOptions: embeddingProviderOptions(cfg),
  });
```

c) Sharpen the dim-mismatch error. Replace the existing `throw new Error(...)` inside the `if (embedding.length !== env.EMBED_DIM)` block with:

```ts
    throw new Error(
      `Embedding dim mismatch: model '${cfg.model}' returned ${embedding.length}, schema expects ${env.EMBED_DIM}. ` +
        `If this is a higher-dimension MRL model, enable "request output dimensions" in settings to truncate to ${env.EMBED_DIM}; ` +
        `otherwise switch to a model that outputs ${env.EMBED_DIM} dims, or re-init at EMBED_DIM=${embedding.length}.`,
    );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/pipeline/pipeline.int.test.ts`
Expected: PASS (the new test and the existing full-pipeline test).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/embed.ts packages/core/test/pipeline/pipeline.int.test.ts
git commit -m "feat(core/pipeline): send dimensions providerOptions from embed stage"
```

---

## Task 6: Setup core — connectivity test + persistence

`testEmbedding` must use the **same** `providerOptions` as the pipeline so the setup/settings check reflects runtime. `completeSetup` must persist the toggle, and `SetupInput` must carry it.

**Files:**
- Modify: `packages/core/src/setup/index.ts`
- Create: `packages/core/test/setup/test-embedding.test.ts`
- Modify: `packages/core/test/setup/setup.int.test.ts`

- [ ] **Step 1: Write the failing unit test for `testEmbedding` threading**

Create `packages/core/test/setup/test-embedding.test.ts`:

```ts
import { describe, expect, test, vi, beforeEach } from 'vitest';

// Capture the `embed` call args. vi.hoisted lets the mock factory reference the spy.
const { embedSpy } = vi.hoisted(() => ({ embedSpy: vi.fn() }));
vi.mock('ai', () => ({
  embed: embedSpy,
  generateText: vi.fn(async () => ({ text: 'ok' })),
}));

describe('testEmbedding honors the dimensions toggle', () => {
  beforeEach(() => {
    embedSpy.mockReset();
    embedSpy.mockResolvedValue({ embedding: Array.from({ length: 1536 }, () => 0.01) });
  });

  test('passes providerOptions when cfg.dimensions is set', async () => {
    const { testEmbedding } = await import('../../src/setup/index.js');
    const res = await testEmbedding({ provider: 'openai', apiKey: 'k', model: 'm', dimensions: 1536 });
    expect(res.ok).toBe(true);
    expect(res.dim).toBe(1536);
    expect(embedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ providerOptions: { openai: { dimensions: 1536 } } }),
    );
  });

  test('omits providerOptions (undefined) when cfg.dimensions is unset', async () => {
    const { testEmbedding } = await import('../../src/setup/index.js');
    await testEmbedding({ provider: 'openai', apiKey: 'k', model: 'm' });
    expect(embedSpy).toHaveBeenCalledWith(expect.objectContaining({ providerOptions: undefined }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/setup/test-embedding.test.ts`
Expected: FAIL — `embed` is called without a `providerOptions` property.

- [ ] **Step 3: Implement `testEmbedding` threading in `setup/index.ts`**

In `packages/core/src/setup/index.ts`:

a) Add `embeddingProviderOptions` to the `../ai` import:

```ts
import {
  resolveEmbedding,
  resolveLLM,
  embeddingProviderOptions,
  type EmbeddingConfig,
  type LLMConfig,
} from '../ai';
```

b) Update the `embed(...)` call inside `testEmbedding`:

```ts
    const { embedding } = await embed({
      model: resolveEmbedding(cfg),
      value: 'ping',
      providerOptions: embeddingProviderOptions(cfg),
    });
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/setup/test-embedding.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `requestDimensions` to `SetupInput` and persist it in `completeSetup`**

In `packages/core/src/setup/index.ts`:

a) Extend the `SetupInput.embedding` shape:

```ts
  embedding: { provider: string; baseUrl?: string; apiKey?: string; model: string; requestDimensions?: boolean };
```

b) In `completeSetup`'s `.values({ ... })`, add the persisted column right after `embedModel`:

```ts
      embedModel: input.embedding.model,
      embedRequestDimensions: input.embedding.requestDimensions ?? false,
```

- [ ] **Step 6: Extend the setup integration test to assert persistence**

In `packages/core/test/setup/setup.int.test.ts`, the existing test selects `embed_dim, password_hash, interest_tags`. Update the query and assertions in that test to also cover `embed_request_dimensions`. Change the SELECT row type + query to include the column, pass `requestDimensions: true` in the `completeSetup` embedding input, and assert it round-trips:

```ts
    const rows = await sql<{ embed_dim: number; password_hash: string; interest_tags: string[]; embed_request_dimensions: boolean }[]>`
      SELECT embed_dim, password_hash, interest_tags, embed_request_dimensions FROM user_settings WHERE id = 1`;
    expect(rows[0]!.embed_dim).toBe(1536);
    expect(rows[0]!.embed_request_dimensions).toBe(true);
```

And in the `completeSetup({ ... })` call within that same test, set the embedding input's `requestDimensions: true`:

```ts
      embedding: { provider: 'openai', model: 'text-embedding-3-large', requestDimensions: true },
```

(If the existing test's embedding input differs, keep its provider/model and only add `requestDimensions: true`.)

- [ ] **Step 7: Run the setup integration test**

Run: `pnpm --filter @benkyou/core exec vitest run test/setup/setup.int.test.ts`
Expected: PASS (Docker required for Testcontainers).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/setup/index.ts packages/core/test/setup/
git commit -m "feat(core/setup): connectivity test + completeSetup honor dimensions toggle"
```

---

## Task 7: i18n keys (zh + en)

Add the toggle label + help text, and sharpen the `dimMismatch` copy to suggest enabling the toggle (the "smart error"). Both locales must stay in parity or `check:i18n` fails. Do this **before** the forms (Tasks 8–9) so the components never reference a missing key.

**Files:**
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Add keys to `apps/web/messages/zh.json`**

In the `"setup"` object, add two keys and replace `dimMismatch`:

```json
    "requestDimensions": "请求输出维度（截断到 {dim}）",
    "requestDimensionsHelp": "高维模型（如 3072 维）勾选此项后，会请求模型直接返回 {dim} 维向量，无需更换 vector 列。模型需支持 dimensions / Matryoshka 截断。",
    "dimMismatch": "Embedding 维度 {got} 与 EMBED_DIM={want} 不一致。若为高维模型，请勾选「请求输出维度」截断到 {want}；否则改用匹配的模型或更换 EMBED_DIM 重新初始化。",
```

In the `"settings"` object, add two keys and replace `dimMismatch`:

```json
    "requestDimensions": "请求输出维度（截断到 {dim}）",
    "requestDimensionsHelp": "高维模型勾选此项后，请求模型返回 {dim} 维向量。模型需支持 dimensions / Matryoshka 截断。",
    "dimMismatch": "Embedding 维度 {got} 与固定值 {want} 不一致。若为高维模型，请勾选「请求输出维度」截断到 {want}。",
```

- [ ] **Step 2: Add the matching keys to `apps/web/messages/en.json`**

In the `"setup"` object:

```json
    "requestDimensions": "Request output dimensions (truncate to {dim})",
    "requestDimensionsHelp": "For high-dim models (e.g. 3072), check this to ask the model to return {dim}-dim vectors directly — no vector column change needed. The model must support dimensions / Matryoshka truncation.",
    "dimMismatch": "Embedding dim {got} != EMBED_DIM={want}. If this is a high-dim model, check \"Request output dimensions\" to truncate to {want}; otherwise use a matching model or re-init with a different EMBED_DIM.",
```

In the `"settings"` object:

```json
    "requestDimensions": "Request output dimensions (truncate to {dim})",
    "requestDimensionsHelp": "For high-dim models, check this to request {dim}-dim vectors. The model must support dimensions / Matryoshka truncation.",
    "dimMismatch": "Embedding dim {got} != frozen {want}. If this is a high-dim model, check \"Request output dimensions\" to truncate to {want}.",
```

- [ ] **Step 3: Verify locale parity**

Run: `pnpm check:i18n`
Expected: PASS (no missing/extra keys between zh and en).

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "i18n: embedding dimensions toggle labels + smarter dim-mismatch copy"
```

---

## Task 8: Setup form + action

Add the checkbox to onboarding, pass `embedDim` into the form for the label, and thread the value through the action into both the connectivity test and `completeSetup`.

**Files:**
- Modify: `apps/web/app/setup/page.tsx`
- Modify: `apps/web/app/setup/SetupForm.tsx`
- Modify: `apps/web/app/setup/actions.ts`

- [ ] **Step 1: Pass `embedDim` into `SetupForm`**

In `apps/web/app/setup/page.tsx`, `env` is already imported. Change the render of `<SetupForm />` to pass the frozen dim:

```tsx
      {env.INITIAL_PASSWORD ? <SetupForm embedDim={env.EMBED_DIM} /> : <p className="text-red-600">{t('needInitialPassword')}</p>}
```

- [ ] **Step 2: Accept the prop and add the checkbox in `SetupForm.tsx`**

In `apps/web/app/setup/SetupForm.tsx`, change the component signature:

```tsx
export function SetupForm({ embedDim }: { embedDim: number }) {
```

Then, inside the embedding `<fieldset>`, add the checkbox after the `embedModel` input (before `</fieldset>`):

```tsx
        <input name="embedModel" required placeholder={t('model')} className={field} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="embedRequestDimensions" />
          <span>{t('requestDimensions', { dim: embedDim })}</span>
        </label>
        <p className="text-xs text-slate-500">{t('requestDimensionsHelp', { dim: embedDim })}</p>
```

- [ ] **Step 3: Thread the value through `setup/actions.ts`**

In `apps/web/app/setup/actions.ts`, inside `setupAction`, after `const v = parsed.data;` read the checkbox and derive the requested dim (`env` is already imported):

```ts
  const v = parsed.data;
  const requestDimensions = fd.get('embedRequestDimensions') === 'on';
```

Update the `embedCfg` construction to carry `dimensions` so the connectivity test matches runtime:

```ts
  const embedCfg = {
    provider: v.embedProvider,
    baseUrl: v.embedBaseUrl,
    apiKey: v.embedApiKey,
    model: v.embedModel,
    dimensions: requestDimensions ? env.EMBED_DIM : undefined,
  };
```

And pass `requestDimensions` into `completeSetup`'s embedding input:

```ts
    embedding: { ...embedCfg, requestDimensions },
```

(Replace the existing `embedding: embedCfg,` line. The extra `dimensions` field on the object is harmless — `completeSetup` reads only the fields it needs.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @benkyou/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/setup/
git commit -m "feat(web/setup): request-dimensions toggle in onboarding form"
```

---

## Task 9: Settings form + action

Same wiring for the live settings page, with the checkbox defaulting to the stored value.

**Files:**
- Modify: `apps/web/app/(authed)/settings/SettingsForm.tsx`
- Modify: `apps/web/app/(authed)/settings/actions.ts`

- [ ] **Step 1: Add the checkbox in `SettingsForm.tsx`**

In `apps/web/app/(authed)/settings/SettingsForm.tsx`, the component already receives `{ settings, embedDim }`. Add the checkbox right after the `embedModel` input (before the existing `embedDimNote` paragraph):

```tsx
      <input name="embedModel" required defaultValue={settings.embedModel ?? ''} className={field} placeholder="embed model" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="embedRequestDimensions" defaultChecked={settings.embedRequestDimensions} />
        <span>{t('requestDimensions', { dim: embedDim })}</span>
      </label>
      <p className="text-xs text-slate-500">{t('requestDimensionsHelp', { dim: embedDim })}</p>
```

- [ ] **Step 2: Thread the value through `settings/actions.ts`**

In `apps/web/app/(authed)/settings/actions.ts`, inside `updateSettingsAction`, after `const v = parsed.data;` add (`env` is already imported):

```ts
  const v = parsed.data;
  const requestDimensions = fd.get('embedRequestDimensions') === 'on';
```

Update `embedCfg` so the connectivity test reflects runtime:

```ts
  const embedCfg = {
    provider: v.embedProvider,
    baseUrl: v.embedBaseUrl,
    apiKey: v.embedApiKey,
    model: v.embedModel,
    dimensions: requestDimensions ? env.EMBED_DIM : undefined,
  };
```

Add the field to the `updateSettings({ ... })` call (after `embedModel: v.embedModel,`):

```ts
    embedModel: v.embedModel,
    embedRequestDimensions: requestDimensions,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @benkyou/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(authed)/settings/"
git commit -m "feat(web/settings): request-dimensions toggle + persistence"
```

---

## Task 10: Docs + invariant updates

Keep the canonical spec and `CLAUDE.md` honest about the new capability.

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-benkyou-design.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Addendum in the master spec**

In `docs/superpowers/specs/2026-05-27-benkyou-design.md`, find the `> **关于 embedding 维度**` note (around the `item_embeddings` / `vector($EMBED_DIM)` section, ~line 310). Append a sentence to that blockquote:

```
> **维度请求（截断）**：若所选模型原生维度高于 `embed_dim`，可在设置中开启 `embed_request_dimensions`，运行时向 provider 传入 dimensions 参数（openai: `dimensions`，google: `outputDimensionality`，openai-compatible/ollama: `openaiCompatible.dimensions`），让模型直接返回 `embed_dim` 维向量——**请求维度恒等于 `embed_dim`**，不改变冻结的列类型，也不需要 halfvec。注意：Google 在 `outputDimensionality < 原生维度` 时不会自动归一化；当前搜索用余弦距离 `<=>`（尺度无关）不受影响，若将来改用 `<#>`/`<->` 需在写入前做 L2 归一化。开启开关不会自动 re-embed 存量语料。
```

- [ ] **Step 2: One-sentence note in `CLAUDE.md`**

In `CLAUDE.md`, under the **"Embedding dimension is frozen at install time"** hard-invariant section, append:

```
A high-native-dim model can be made to *fit* the frozen dim by enabling `user_settings.embed_request_dimensions`, which sends a per-request `dimensions` parameter so the model truncates to `embed_dim`. This does **not** change the frozen dimension — the requested value always equals `embed_dim`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-27-benkyou-design.md CLAUDE.md
git commit -m "docs: document per-request embedding dimensions (truncation)"
```

---

## Task 11: Full verification

Run the complete CI suite and a manual UI smoke before declaring done. (Per `CLAUDE.md`'s "Before Submitting a Change".)

- [ ] **Step 1: Lint + typecheck + i18n + tests**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm test
```
Expected: all PASS. (`pnpm test` runs the `.int` suites — Docker must be available.)

- [ ] **Step 2: Manual UI smoke (settings page)**

```bash
pnpm --filter @benkyou/web dev
```
Then in the browser at `/settings`:
1. Confirm the "Request output dimensions (truncate to 1536)" checkbox renders with help text under the embed model field.
2. Toggle it and Save — confirm it persists across reload (the box reflects the stored value).
3. With a high-dim model configured and the box **off**, Save → confirm the `dimMismatch` message now suggests enabling the toggle.
4. With the box **on** and a supported MRL model, Save → confirm it succeeds.

Don't claim "looks good" without actually clicking through these.

- [ ] **Step 3: Final confirmation**

Confirm the working tree is clean except for the intentional changes, and that `git log --oneline` shows the per-task commits. The feature is complete and ready to integrate into `worktree-m1b-product`.

---

## Self-Review (completed during plan authoring)

- **Spec coverage:** §4.1 data model → Task 1; §4.1 env → Task 2; §4.2 provider mapping → Task 3; §4.3 settings derivation → Task 4; §4.4 pipeline → Task 5; §4.5 connectivity test + persistence → Task 6; §4.6 UI → Tasks 8–9; §4.7 i18n → Task 7; §6 caveats + §8 doc updates → Task 10; §7 test plan → Tasks 3/4/5/6; final CI gate → Task 11. No gaps.
- **Placeholder scan:** none — every code/command step is concrete.
- **Type consistency:** `embedRequestDimensions` (DB/settings/SetupInput→`requestDimensions` at the setup boundary), `embeddingProviderOptions(cfg)`, `EmbeddingConfig.dimensions`, key `openaiCompatible` — used consistently across Tasks 1–9.
