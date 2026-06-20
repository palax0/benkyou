# M2b — No-Subtitle Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give direct-media URL pastes and podcast-RSS `<enclosure>` audio a Whisper transcription path, through a generic deferred-advancement runner seam, a dedicated `transcribe` queue with per-job expiry, and a confirm sub-flow for over-auto-limit pastes.

**Architecture:** `extract` gains the ability to *hand off* (return `{advance:false}`) instead of advancing. For a transcribe-eligible media item it resolves audio duration (remote ffprobe / `itunes:duration`), runs a pure `transcribePolicy`, and either enqueues a `transcribe` job (its own queue, own dead-letter, per-job wall-time budget), parks the item as `needs_confirmation`, or skips-and-continues. `transcribe` downloads → ffmpeg-chunks → concurrent Whisper → timestamp-merges into the same timed `transcript_segments` contract M2a subtitles use, then advances `pending → extracted → embed`. A prerequisite refactor first consolidates all `ai_usage` recording into the `core/ai` wrapper layer and extends it for `kind='transcription'`.

**Tech Stack:** TypeScript 5.7 strict, pg-boss 12, Drizzle 0.45, Vitest 4 + Testcontainers 12, Vercel AI SDK 6 (Whisper has its own thin client — not in the SDK), `p-limit` (new), `ffmpeg`/`ffprobe` (worker image only), next-intl 4.

## Global Constraints

Copied verbatim from the spec / repo invariants — every task's requirements implicitly include these:

- **Pipeline state machine unchanged.** 6 states `pending → extracted → embedded → scored → dedup_done → done` (+ `failed`). On failure state does NOT change — only `attempts++`/`last_error`. All user-visible queries filter `state='done'`.
- **The at-least-once runner guard stays hole-free.** `runItemStage`'s top guard (`current !== STAGE_REQUIRED_STATE[stage] → return`) gets **no per-stage exception** and **no `transcribe` name**. The seam is a generic `StageOutcome.advance`.
- **`transcribe` is NOT a `PER_ITEM_STAGES` member.** Own queue, own dead-letter (`transcribe-failed`), terminal = degrade to `transcript_status='unavailable'` + **continue** (never `state='failed'`). `retryLimit=2` hardcoded, **independent** of `user_settings.pipeline_max_attempts`.
- **`current_stage` stays `'extract'`** across the whole transcribe/confirm window. The only place it leaves `'extract'` for a transcribed item is `advancePendingToExtracted` (writes `'embed'`).
- **Per-job expiry, never `= video_manual_limit`.** `expireInSeconds = transcribeBudgetSec(durationSec)` = a processing **wall-time** budget (`ceil(durationSec × factor) + overhead`), set at enqueue.
- **Cost is audio minutes only — never money.** No token sum, no currency conversion for transcription (spec §5.3).
- **Provider abstraction.** All LLM/embedding go through `resolveLLM`/`resolveEmbedding`. Whisper has its own thin client. `ai_usage` recording lives in the `core/ai` wrapper layer after Phase A — no call-site `recordUsage`.
- **No new `user_settings` column is UI-writable for dimensions/budgets.** `TRANSCRIBE_MAX_BYTES` is a code constant, not a settings column.
- **TS strict:** no `any` without `// @ts-expect-error` + reason. Named exports only (pages/layouts exempt). Drizzle builders over raw SQL except tsvector/hnsw/custom types.
- **i18n:** every user-visible string through `useTranslations`/`getTranslations`; `pnpm check:i18n` fails on missing zh/en keys.
- **No improvisation in `apps/web/components`:** no raw hex, no Tailwind arbitrary-value brackets, no inline `style=`. Net-new visual gets a `{/* DESIGN-GAP: … */}` structurally-neutral shell.
- **`drizzle-kit generate` needs env:** `EMBED_DIM` + `DATABASE_URL` + `SESSION_SECRET` set, or the snapshot records `vector(undefined)`.
- **Before submitting:** `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm check:i18n && pnpm build && pnpm test`.

---

## File Structure

**New files**
- `packages/core/src/ai/generate.ts` — recording wrappers (`generateTextRecorded`, `streamTextRecorded`, `embedRecorded`, `embedManyRecorded`) around the `ai` SDK; the single place that writes LLM/embedding `ai_usage` rows.
- `packages/core/src/ai/whisper.ts` — thin Whisper-API-compatible client + `transcribeChunk` + `transcribeRecorded` (records `kind='transcription'`).
- `packages/core/src/pipeline/transcribe-policy.ts` — pure `transcribePolicy`.
- `packages/core/src/pipeline/transcribe.ts` — engine: download → ffmpeg chunk → concurrent Whisper → timestamp merge. Pure helpers `planChunks`, `mergeSegments` live here too.
- `packages/core/src/pipeline/transcribe-store.ts` — DB ops: `getTranscribeView`, `writeTranscript`, `setTranscriptStatus`, `advancePendingToExtracted`.
- `packages/core/src/pipeline/media-probe.ts` — `probeRemoteDurationSec` (remote ffprobe) + `downloadToTmp` (guarded streaming download).
- `apps/web/app/api/items/[id]/confirm-transcribe/route.ts` — confirm endpoint.

**Modified files**
- `packages/core/src/ai/usage.ts` — `UsageFields.kind += 'transcription'`, `+ durationSeconds`; `UsageContext + conversationId?`.
- `packages/core/src/pipeline/{embed,score,summary}.ts`, `items/deep-summary.ts`, `search/hybrid.ts` — switch to wrappers, delete inline `recordUsage`.
- `packages/core/src/pipeline/state.ts` — `StageOutcome` type.
- `packages/core/src/queue/runner.ts` — `runItemStage` seam; `runTranscribe`, `handleTranscribeDeadLetter`, `advanceAfterTranscribe`.
- `packages/core/src/queue/queues.ts` — transcribe queue constants, `TranscribeJob`, `transcribeBudgetSec`, `enqueueTranscribe`, transcribe policy in `registerQueues`.
- `packages/core/src/queue/{loop,batch}.ts` — wire transcribe + dead-letter workers/drain.
- `packages/core/src/pipeline/index.ts` — `STAGE_HANDLERS` return type; export new modules.
- `packages/core/src/pipeline/extract.ts` — media handoff branch.
- `packages/core/src/sources/{types,rss,resolve}.ts`, `pipeline/ingest.ts`, `items/paste.ts` — `mediaUrl`/`contentType`/`videoDuration` plumbing; direct-media detection.
- `packages/core/src/db/schema.ts` — `items.mediaUrl`; `aiUsage.conversationId`, `aiUsage.durationSeconds`.
- `packages/core/src/pipeline/status.ts` — transcription lane; orphan exclusion; queue-health list.
- `apps/web/components/TranscriptBadge.tsx`, `apps/web/app/(authed)/items/[id]/page.tsx`, `apps/web/messages/{zh,en}.json`.
- `Dockerfile.worker` — `ffmpeg`.
- `packages/core/package.json` — `p-limit`.
- `docs/superpowers/specs/2026-05-27-benkyou-design.md` — Task 0 deltas.

---

## Task 0: Land canonical spec deltas (List B) — no code

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-benkyou-design.md`
- Delete: `docs/superpowers/reviews/2026-06-14-m2-readiness-review.md`

**Interfaces:**
- Produces: a main spec that no longer contradicts M2b. Every later task assumes these edits exist.

This is documentation only; **it must merge before any code task** (binding per the M2b design doc preamble). List A (`ai_usage.conversation_id`, `duration_seconds`, `kind='transcription'`, the "记账收口到封装层 + 删调用点埋点" rule, "不折算金额", M2 migration timing) is **already** in §5.3 — do not re-add it. Edit only List B.

- [ ] **Step 1: §5.3 schema deltas**

In the §5.3 `items` / status enumerations, add:
- `transcript_status` enum value `needs_confirmation` (plain-text column, no DB enum/CHECK — TS-union only).
- `content_type` value `audio`.
- `items.media_url text` (nullable) — "download source, distinct from canonical `url`; `transcribe` pulls from `media_url ?? url`".

- [ ] **Step 2: §6.2 line ~460 — over-limit paste no longer rejected**

Replace the "拒绝粘贴 / 前端同步报错" text for over-`video_manual_limit` paste with: "over-`manual_limit` paste reuses `transcript_status='skipped_too_long'` and **continues** on title/metadata. Rationale: async paste + ffmpeg-worker-only means duration is known only in `extract`; a synchronous reject would force ffprobe into the web tier."

- [ ] **Step 3: §6.2 line ~457 — single-caller policy**

Replace "web 手动粘贴路径同步调同一函数" with: "the transcribe policy runs **only in `extract`** (async paste — the web tier only creates the item; the worker probes + decides). `transcribePolicy` has a single caller."

- [ ] **Step 4: §6.2 transcribe ownership (new paragraph)**

Add: generic `StageOutcome.advance` seam (no transcribe-named guard hole); `transcribe` is its **own** queue + **own** dead-letter (`unavailable` + continue, never `failed`); `retryLimit=2` hardcoded, independent of `pipeline_max_attempts`; per-job `expireInSeconds = transcribeBudgetSec(durationSec)` (a wall-time budget, explicitly **not** `= video_manual_limit`); `current_stage` stays `'extract'` across the transcribe/confirm window.

- [ ] **Step 5: §15 milestone table — M2b row**

Mark the M2b open decisions resolved: seam shape (generic `StageOutcome`), retry-counter home (pg-boss `retryLimit=2`, `items.attempts` untouched), `skipped_serverless` expression (policy branch 1), job-expiry model (per-job `transcribeBudgetSec`), `current_stage` home (`'extract'`).

- [ ] **Step 6: delete the readiness review + commit**

```bash
git rm docs/superpowers/reviews/2026-06-14-m2-readiness-review.md
git add docs/superpowers/specs/2026-05-27-benkyou-design.md
git commit -m "docs: land M2b spec deltas (List B) before implementation"
```

---

# Phase A — ai_usage consolidation (prerequisite; own PR)

Land this whole phase, open a PR, and merge it **before** Phase B. It is independently shippable and touches every AI call site; keeping it separate keeps the transcription diff reviewable.

## Task A1: ai_usage migration — `conversation_id` + `duration_seconds`

**Files:**
- Modify: `packages/core/src/db/schema.ts:186-205` (the `aiUsage` table)
- Create (generated): `packages/core/src/db/migrations/0007_*.sql`
- Test: `packages/core/test/db/ai-usage-columns.int.test.ts`

**Interfaces:**
- Produces: `aiUsage.conversationId` (uuid, null), `aiUsage.durationSeconds` (int, null) columns + the `kind`/`stage` comment widened.

- [ ] **Step 1: Write the failing migration test**

```ts
// packages/core/test/db/ai-usage-columns.int.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('ai_usage M2b columns', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('db/ai-usage-columns.int.test');
    sql = db.sql;
  }, 120_000);
  afterAll(async () => { await db?.cleanup(); });

  test('conversation_id and duration_seconds exist and are nullable', async () => {
    const cols = await sql<{ column_name: string; is_nullable: string }[]>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'ai_usage' AND column_name IN ('conversation_id','duration_seconds')
      ORDER BY column_name`;
    expect(cols).toEqual([
      { column_name: 'conversation_id', is_nullable: 'YES' },
      { column_name: 'duration_seconds', is_nullable: 'YES' },
    ]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @benkyou/core test ai-usage-columns`
Expected: FAIL — columns do not exist yet.

- [ ] **Step 3: Edit the schema**

In `packages/core/src/db/schema.ts`, inside `aiUsage` after `totalTokens`:

```ts
    totalTokens: integer('total_tokens'),
    durationSeconds: integer('duration_seconds'), // transcription has no tokens; audio seconds instead
    // null until M4 (agent/search threads); migrated now while the table is small (spec §5.3)
    conversationId: uuid('conversation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
```

Also widen the `kind` comment to `'llm' | 'embedding' | 'transcription'`.

- [ ] **Step 4: Generate + review the migration**

```bash
EMBED_DIM=1536 DATABASE_URL=postgres://x SESSION_SECRET=x \
  pnpm --filter @benkyou/core exec drizzle-kit generate
```
Review the new `0007_*.sql`: it must `ALTER TABLE ai_usage ADD COLUMN conversation_id uuid` and `ADD COLUMN duration_seconds integer` only — no vector/index churn.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --filter @benkyou/core test ai-usage-columns`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/migrations packages/core/test/db/ai-usage-columns.int.test.ts
git commit -m "feat(core): add ai_usage.conversation_id + duration_seconds"
```

## Task A2: recording wrappers in `core/ai`

**Files:**
- Modify: `packages/core/src/ai/usage.ts`
- Create: `packages/core/src/ai/generate.ts`
- Modify: `packages/core/src/ai/structured.ts` (add `ctx` to `generateStructured`)
- Modify: `packages/core/src/ai/index.ts` (export `generate.ts`)
- Test: `packages/core/test/ai/generate.test.ts`

**Interfaces:**
- Consumes: `resolveLLM`, `resolveEmbedding`, `embeddingProviderOptions` (ai/provider.ts); `recordUsage` (ai/usage.ts).
- Produces:
  - `UsageContext = { stage: string; itemId?: string | null; conversationId?: string | null }`
  - `UsageFields.kind: 'llm' | 'embedding' | 'transcription'`; `UsageFields.durationSeconds?: number | null`
  - `embedManyRecorded(args: { cfg: EmbeddingConfig; ctx: UsageContext; values: string[] }): Promise<{ embeddings: number[][]; usage?: { tokens?: number } }>`
  - `embedRecorded(args: { cfg: EmbeddingConfig; ctx: UsageContext; value: string }): Promise<{ embedding: number[]; usage?: { tokens?: number } }>`
  - `generateTextRecorded(args: { cfg: LLMConfig; ctx: UsageContext; prompt: string }): Promise<{ text: string }>`
  - `streamTextRecorded(args: { cfg: LLMConfig; ctx: UsageContext; prompt: string; onText?: (text: string) => Promise<void> }): { toTextStreamResponse(): Response }`
  - `generateStructured(opts & { ctx: UsageContext })` now records internally (returns `{ object }` only — `usage` becomes internal).

- [ ] **Step 1: Extend `UsageFields`/`UsageContext`**

In `packages/core/src/ai/usage.ts`:

```ts
export interface UsageContext {
  stage: string;
  itemId?: string | null;
  conversationId?: string | null;
}

export interface UsageFields {
  kind: 'llm' | 'embedding' | 'transcription';
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationSeconds?: number | null;
}
```

In the `recordUsage` insert body add:
```ts
      totalTokens: finiteOrNull(fields.totalTokens),
      durationSeconds: finiteOrNull(fields.durationSeconds ?? null),
      conversationId: ctx.conversationId ?? null,
```

- [ ] **Step 2: Write the failing wrapper test**

```ts
// packages/core/test/ai/generate.test.ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(async () => ({ text: 'hi', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } })),
    embedMany: vi.fn(async () => ({ embeddings: [[0.1], [0.2]], usage: { tokens: 9 } })),
  };
});

describe('core/ai recording wrappers', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let generateTextRecorded: typeof import('../../src/ai/generate.js').generateTextRecorded;
  let embedManyRecorded: typeof import('../../src/ai/generate.js').embedManyRecorded;
  let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('ai/generate.test');
    sql = db.sql;
    ({ generateTextRecorded, embedManyRecorded } = await import('../../src/ai/generate.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeDbClient?.(); await db?.cleanup(); });

  test('generateTextRecorded writes exactly one llm row', async () => {
    await generateTextRecorded({
      cfg: { provider: 'openai', model: 'm', apiKey: 'k' },
      ctx: { stage: 'summary', itemId: null },
      prompt: 'p',
    });
    const r = await sql<{ kind: string; total_tokens: number }[]>`SELECT kind,total_tokens FROM ai_usage WHERE stage='summary'`;
    expect(r).toEqual([{ kind: 'llm', total_tokens: 7 }]);
  });

  test('embedManyRecorded writes exactly one embedding row', async () => {
    await embedManyRecorded({
      cfg: { provider: 'openai', model: 'e', apiKey: 'k' },
      ctx: { stage: 'embed', itemId: null },
      values: ['a', 'b'],
    });
    const r = await sql<{ kind: string; total_tokens: number; output_tokens: number | null }[]>`SELECT kind,total_tokens,output_tokens FROM ai_usage WHERE stage='embed'`;
    expect(r).toEqual([{ kind: 'embedding', total_tokens: 9, output_tokens: null }]);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter @benkyou/core test ai/generate`
Expected: FAIL — `generate.js` does not exist.

- [ ] **Step 4: Implement `ai/generate.ts`**

```ts
import { embed, embedMany, generateText, streamText } from 'ai';
import {
  resolveLLM, resolveEmbedding, embeddingProviderOptions,
  type LLMConfig, type EmbeddingConfig,
} from './provider';
import { recordUsage, type UsageContext } from './usage';

export async function generateTextRecorded(args: {
  cfg: LLMConfig; ctx: UsageContext; prompt: string;
}): Promise<{ text: string }> {
  const { text, usage } = await generateText({ model: resolveLLM(args.cfg), prompt: args.prompt });
  await recordUsage(args.ctx, {
    kind: 'llm', model: args.cfg.model,
    inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null,
  });
  return { text };
}

export function streamTextRecorded(args: {
  cfg: LLMConfig; ctx: UsageContext; prompt: string; onText?: (text: string) => Promise<void>;
}): ReturnType<typeof streamText> {
  return streamText({
    model: resolveLLM(args.cfg),
    prompt: args.prompt,
    onFinish: async ({ text, usage }) => {
      if (args.onText) await args.onText(text);
      await recordUsage(args.ctx, {
        kind: 'llm', model: args.cfg.model,
        inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null,
      });
    },
  });
}

export async function embedManyRecorded(args: {
  cfg: EmbeddingConfig; ctx: UsageContext; values: string[];
}): Promise<{ embeddings: number[][]; usage?: { tokens?: number } }> {
  const { embeddings, usage } = await embedMany({
    model: resolveEmbedding(args.cfg), values: args.values,
    providerOptions: embeddingProviderOptions(args.cfg),
  });
  await recordUsage(args.ctx, {
    kind: 'embedding', model: args.cfg.model,
    inputTokens: usage?.tokens ?? null, outputTokens: null, totalTokens: usage?.tokens ?? null,
  });
  return { embeddings, usage };
}

export async function embedRecorded(args: {
  cfg: EmbeddingConfig; ctx: UsageContext; value: string;
}): Promise<{ embedding: number[]; usage?: { tokens?: number } }> {
  const { embedding, usage } = await embed({
    model: resolveEmbedding(args.cfg), value: args.value,
    providerOptions: embeddingProviderOptions(args.cfg),
  });
  await recordUsage(args.ctx, {
    kind: 'embedding', model: args.cfg.model,
    inputTokens: usage?.tokens ?? null, outputTokens: null, totalTokens: usage?.tokens ?? null,
  });
  return { embedding, usage };
}
```

Add to `packages/core/src/ai/index.ts`: `export * from './generate';`.

- [ ] **Step 5: Add `ctx` to `generateStructured` and record internally**

In `packages/core/src/ai/structured.ts`: import `recordUsage`, `type UsageContext`. Add `ctx: UsageContext` to `GenerateStructuredOptions`. In **both** return branches, before returning, call:
```ts
await recordUsage(opts.ctx, {
  kind: 'llm', model: opts.cfg.model,
  inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
});
```
Change the return type to `Promise<{ object: T }>` (drop `usage` from the public return — recording is now internal). Keep computing `usage` locally for the record call.

- [ ] **Step 6: Run the test to confirm it passes**

Run: `pnpm --filter @benkyou/core test ai/generate`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/ai
git commit -m "feat(core): ai recording wrappers (generate.ts) + ctx on generateStructured"
```

## Task A3: migrate the 5 call sites; delete inline `recordUsage`

**Files:**
- Modify: `packages/core/src/pipeline/embed.ts`, `pipeline/score.ts`, `pipeline/summary.ts`, `items/deep-summary.ts`, `search/hybrid.ts`
- Modify: `packages/core/test/pipeline/usage-points.int.test.ts` (assertions unchanged; only the mocked-shape if needed)
- Test: existing `usage-points.int.test.ts` + a no-double-count assertion.

**Interfaces:**
- Consumes: the Task A2 wrappers.
- Produces: zero `recordUsage` calls outside `core/ai`.

- [ ] **Step 1: Add a "no double count" assertion to the existing test**

Append to `packages/core/test/pipeline/usage-points.int.test.ts` inside the describe:

```ts
  test('each AI stage records exactly one row (no call-site double count)', async () => {
    const id = await seedItem('extracted');
    await embedItem(id);
    const r = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ai_usage WHERE item_id = ${id}`;
    expect(r[0]!.n).toBe(1);
  });
```

- [ ] **Step 2: Run it — confirm current code already passes (baseline), then refactor must keep it passing**

Run: `pnpm --filter @benkyou/core test usage-points`
Expected: PASS (baseline).

- [ ] **Step 3: Refactor `embed.ts`**

Replace the `embedMany` + `recordUsage` block with:
```ts
import { embedManyRecorded } from '../ai';
// ...
const { embeddings } = await embedManyRecorded({
  cfg, ctx: { stage: 'embed', itemId }, values: [docText, titleText],
});
```
Drop the `recordUsage`, `resolveEmbedding`, `embeddingProviderOptions` imports if now unused (keep `env` for the dim guard). The dim guard on `embeddings` stays exactly as is.

- [ ] **Step 4: Refactor `score.ts`**

```ts
import { generateStructured } from '../ai';
const { object } = await generateStructured({
  cfg, schema: scoreSchema, prompt, ctx: { stage: 'score', itemId },
});
```
Delete the `recordUsage` import + call.

- [ ] **Step 5: Refactor `summary.ts`**

```ts
import { generateTextRecorded } from '../ai';
const { text } = await generateTextRecorded({ cfg, ctx: { stage: 'summary', itemId }, prompt });
```
Delete the direct `generateText`/`resolveLLM`/`recordUsage` imports if unused.

- [ ] **Step 6: Refactor `items/deep-summary.ts`**

```ts
import { streamTextRecorded } from '../ai/generate';
const result = streamTextRecorded({
  cfg, ctx: { stage: 'deep_summary', itemId: id }, prompt: buildDeepSummaryPrompt({ title: item.title, rawContent: item.rawContent }, lang),
  onText: async (text) => { await saveDeepSummary(id, text); },
});
return result.toTextStreamResponse();
```
Delete the `streamText`/`resolveLLM`/`recordUsage` imports.

- [ ] **Step 7: Refactor `search/hybrid.ts`**

```ts
import { embedRecorded } from '../ai';
const { embedding } = await embedRecorded({ cfg, ctx: { stage: 'search', itemId: null }, value: query });
```
Delete the `embed`/`resolveEmbedding`/`embeddingProviderOptions`/`recordUsage` imports (keep `sql`). The dim guard + `vecLiteral` stay.

- [ ] **Step 8: Grep to prove the call sites are gone**

```bash
grep -rn "recordUsage" packages/core/src apps/web/app | grep -v 'src/ai/'
```
Expected: only matches inside `packages/core/src/ai/` (usage.ts, generate.ts, structured.ts).

- [ ] **Step 9: Run the full core suite**

Run: `pnpm --filter @benkyou/core test usage-points score summary search`
Expected: PASS — each stage still records exactly one row.

- [ ] **Step 10: Commit + open Phase A PR**

```bash
git add packages/core/src packages/core/test
git commit -m "refactor(core): record ai_usage in the wrapper layer; delete call-site instrumentation"
```
Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then open + merge the Phase A PR before Phase B.

---

# Phase B — Transcription

## Task B1: media inputs — `media_url` schema + `RawItem` plumbing + podcast `<enclosure>`

**Files:**
- Modify: `packages/core/src/db/schema.ts:120-174` (`items` table)
- Create (generated): `packages/core/src/db/migrations/0008_*.sql`
- Modify: `packages/core/src/sources/types.ts` (RawItem + ExtractResult contentType)
- Modify: `packages/core/src/sources/rss.ts` (parse enclosure + itunes:duration)
- Modify: `packages/core/src/pipeline/ingest.ts:45-62` (write the three fields)
- Test: `packages/core/test/sources/rss-enclosure.test.ts`, `packages/core/test/pipeline/ingest-media.int.test.ts`

**Interfaces:**
- Produces:
  - `items.mediaUrl: text | null` column.
  - `RawItem += { mediaUrl: string | null; contentType: ContentType; videoDuration: number | null }`
  - `type ContentType = 'article' | 'video' | 'discussion' | 'paper' | 'audio'`
  - `ingestSource` writes `contentType: r.contentType ?? 'article'`, `mediaUrl: r.mediaUrl`, `videoDuration: r.videoDuration`.

- [ ] **Step 1: Write the failing RSS-enclosure parse test**

```ts
// packages/core/test/sources/rss-enclosure.test.ts
import { describe, expect, test, vi } from 'vitest';
import { rssAdapter } from '../../src/sources/rss.js';

const FEED = `<?xml version="1.0"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
  <item>
    <title>Ep 1</title><link>https://pod.example/ep1</link><guid>ep1</guid>
    <enclosure url="https://cdn.example/ep1.mp3" type="audio/mpeg" length="12345"/>
    <itunes:duration>1:02:03</itunes:duration>
  </item>
</channel></rss>`;

describe('rss enclosure → audio RawItem', () => {
  test('parses enclosure url + itunes:duration as audio item', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(FEED, { status: 200 }));
    const items = await rssAdapter.fetchItems({ url: 'https://pod.example/feed' });
    expect(items[0]).toMatchObject({
      url: 'https://pod.example/ep1',
      mediaUrl: 'https://cdn.example/ep1.mp3',
      contentType: 'audio',
      videoDuration: 3723, // 1*3600 + 2*60 + 3
    });
    vi.restoreAllMocks();
  });

  test('item without enclosure stays an article with null media', async () => {
    const noEncl = FEED.replace(/<enclosure[^>]*\/>/, '').replace(/<itunes:duration>.*<\/itunes:duration>/, '');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(noEncl, { status: 200 }));
    const items = await rssAdapter.fetchItems({ url: 'https://pod.example/feed' });
    expect(items[0]).toMatchObject({ contentType: 'article', mediaUrl: null, videoDuration: null });
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run it — confirm it fails**

Run: `pnpm --filter @benkyou/core test rss-enclosure`
Expected: FAIL — `mediaUrl`/`contentType` not produced.

- [ ] **Step 3: Extend `types.ts`**

In `packages/core/src/sources/types.ts`:
```ts
export type ContentType = 'article' | 'video' | 'discussion' | 'paper' | 'audio';

export interface RawItem {
  externalId: string | null;
  url: string;
  title: string;
  author: string | null;
  publishedAt: Date | null;
  content: string | null;
  mediaUrl: string | null;       // direct audio/video download source (podcast enclosure); null for plain articles
  contentType: ContentType;      // ingest writes this instead of hard-coding 'article'
  videoDuration: number | null;  // seconds; from itunes:duration when present
}
```
Change `ExtractResult.contentType` to `ContentType`.

- [ ] **Step 4: Parse enclosure + duration in `rss.ts`**

Add a duration parser and extend the field map. Add `enclosure?: { url?: string; type?: string }` and `itunesDuration?: string` to `FeedItem`; register custom fields `['itunes:duration', 'itunesDuration']` (rss-parser surfaces `enclosure` natively).

```ts
// hh:mm:ss | mm:ss | ss → seconds; null on garbage
export function parseItunesDuration(raw: string | undefined): number | null {
  if (!raw) return null;
  const parts = raw.trim().split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
  return Number.isFinite(secs) && secs > 0 ? Math.round(secs) : null;
}
```
In the `.map` body:
```ts
const enclosureUrl =
  it.enclosure?.type?.startsWith('audio/') || it.enclosure?.type?.startsWith('video/')
    ? (it.enclosure.url ?? null) : null;
return {
  externalId: it.guid ?? it.link ?? null,
  url: it.link ?? '',
  title: it.title ?? '(untitled)',
  author: it.creator ?? it.author ?? null,
  publishedAt: when ? new Date(when) : null,
  content: it.contentEncoded ?? it.content ?? null,
  mediaUrl: enclosureUrl,
  contentType: enclosureUrl ? 'audio' : 'article',
  videoDuration: parseItunesDuration(it.itunesDuration),
};
```
Export `parseItunesDuration`.

- [ ] **Step 5: Run the RSS test — confirm it passes**

Run: `pnpm --filter @benkyou/core test rss-enclosure`
Expected: PASS.

- [ ] **Step 6: Schema column + migration**

In `schema.ts` `items`, after `url`/`urlHash` group (near `contentType`):
```ts
    mediaUrl: text('media_url'), // download source distinct from canonical url; transcribe pulls media_url ?? url
```
Generate + review:
```bash
EMBED_DIM=1536 DATABASE_URL=postgres://x SESSION_SECRET=x \
  pnpm --filter @benkyou/core exec drizzle-kit generate
```
The `0008_*.sql` must be a single `ALTER TABLE items ADD COLUMN media_url text`.

- [ ] **Step 7: Write the failing ingest-media integration test**

```ts
// packages/core/test/pipeline/ingest-media.int.test.ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

const FEED = `<?xml version="1.0"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
  <item><title>Ep</title><link>https://pod/ep</link><guid>ep</guid>
  <enclosure url="https://cdn/ep.mp3" type="audio/mpeg" length="1"/>
  <itunes:duration>120</itunes:duration></item>
</channel></rss>`;

describe('ingestSource persists media fields', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let ingestSource: (id: string) => Promise<{ inserted: string[] }>;
  let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/ingest-media.int.test');
    sql = db.sql;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(FEED, { status: 200 }));
    ({ ingestSource } = await import('../../src/pipeline/ingest.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); await closeDbClient?.(); await db?.cleanup(); });

  test('enclosure episode lands as audio with media_url + video_duration', async () => {
    const s = await sql<{ id: string }[]>`INSERT INTO sources (type,name,config) VALUES ('rss','P', '{"url":"https://pod/feed"}'::jsonb) RETURNING id`;
    await ingestSource(s[0]!.id);
    const r = await sql<{ content_type: string; media_url: string; video_duration: number }[]>`
      SELECT content_type, media_url, video_duration FROM items WHERE url='https://pod/ep'`;
    expect(r[0]).toEqual({ content_type: 'audio', media_url: 'https://cdn/ep.mp3', video_duration: 120 });
  });
});
```

- [ ] **Step 8: Run it — confirm it fails**

Run: `pnpm --filter @benkyou/core test ingest-media`
Expected: FAIL — `ingestSource` still hard-codes `contentType: 'article'`, `media_url` null.

- [ ] **Step 9: Update `ingestSource` insert**

In `pipeline/ingest.ts` the `.values({...})`:
```ts
        contentType: r.contentType ?? 'article',
        mediaUrl: r.mediaUrl,
        videoDuration: r.videoDuration,
        rawContent: r.content,
```
(remove the old literal `contentType: 'article'`).

- [ ] **Step 10: Run both tests — confirm they pass**

Run: `pnpm --filter @benkyou/core test ingest-media rss-enclosure`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "feat(core): media_url column + podcast enclosure/itunes:duration ingestion"
```

## Task B2: `transcribe-policy.ts` (pure)

**Files:**
- Create: `packages/core/src/pipeline/transcribe-policy.ts`
- Test: `packages/core/test/pipeline/transcribe-policy.test.ts`

**Interfaces:**
- Produces:
```ts
export type TranscribeDecision =
  | { kind: 'transcribe' }
  | { kind: 'confirm'; estimatedMinutes: number }
  | { kind: 'skip'; status: 'skipped_too_long' | 'skipped_serverless' };
export function transcribePolicy(i: {
  durationSec: number; isAdhoc: boolean;
  deployMode: 'docker' | 'serverless';
  autoLimit: number; manualLimit: number;
}): TranscribeDecision;
```

- [ ] **Step 1: Write the failing test (every branch)**

```ts
// packages/core/test/pipeline/transcribe-policy.test.ts
import { describe, expect, test } from 'vitest';
import { transcribePolicy } from '../../src/pipeline/transcribe-policy.js';

const base = { isAdhoc: true, deployMode: 'docker' as const, autoLimit: 1800, manualLimit: 10800 };

describe('transcribePolicy', () => {
  test('serverless always skips with skipped_serverless (even within auto limit)', () => {
    expect(transcribePolicy({ ...base, durationSec: 60, deployMode: 'serverless' }))
      .toEqual({ kind: 'skip', status: 'skipped_serverless' });
  });
  test('within auto limit → transcribe (adhoc)', () => {
    expect(transcribePolicy({ ...base, durationSec: 1800 })).toEqual({ kind: 'transcribe' });
  });
  test('within auto limit → transcribe (auto source)', () => {
    expect(transcribePolicy({ ...base, durationSec: 1000, isAdhoc: false })).toEqual({ kind: 'transcribe' });
  });
  test('auto source over auto limit → skipped_too_long (never prompts)', () => {
    expect(transcribePolicy({ ...base, durationSec: 3600, isAdhoc: false }))
      .toEqual({ kind: 'skip', status: 'skipped_too_long' });
  });
  test('adhoc between auto and manual → confirm with estimatedMinutes', () => {
    expect(transcribePolicy({ ...base, durationSec: 3600 })).toEqual({ kind: 'confirm', estimatedMinutes: 60 });
  });
  test('adhoc over manual limit → skipped_too_long (direct-media over-limit skip, revises §6.2)', () => {
    expect(transcribePolicy({ ...base, durationSec: 20000 }))
      .toEqual({ kind: 'skip', status: 'skipped_too_long' });
  });
});
```

- [ ] **Step 2: Run it — confirm it fails**

Run: `pnpm --filter @benkyou/core test transcribe-policy`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement (branch order = first match wins)**

```ts
export type TranscribeDecision =
  | { kind: 'transcribe' }
  | { kind: 'confirm'; estimatedMinutes: number }
  | { kind: 'skip'; status: 'skipped_too_long' | 'skipped_serverless' };

// Single chokepoint, called only from extract (async paste). Cost is audio minutes
// only — never money (spec §5.3). Branch order is significant.
export function transcribePolicy(i: {
  durationSec: number; isAdhoc: boolean;
  deployMode: 'docker' | 'serverless';
  autoLimit: number; manualLimit: number;
}): TranscribeDecision {
  // 1. serverless can't fit minute-scale work in a 10s budget (spec §11.2).
  if (i.deployMode === 'serverless') return { kind: 'skip', status: 'skipped_serverless' };
  // 2. within auto limit → transcribe (auto AND adhoc).
  if (i.durationSec <= i.autoLimit) return { kind: 'transcribe' };
  // 3. auto sources never prompt.
  if (!i.isAdhoc) return { kind: 'skip', status: 'skipped_too_long' };
  // 4. adhoc, auto < dur ≤ manual → confirm.
  if (i.durationSec <= i.manualLimit) return { kind: 'confirm', estimatedMinutes: Math.round(i.durationSec / 60) };
  // 5. adhoc over manual → skip+continue (revises §6.2 "拒绝粘贴").
  return { kind: 'skip', status: 'skipped_too_long' };
}
```

- [ ] **Step 4: Run it — confirm it passes**

Run: `pnpm --filter @benkyou/core test transcribe-policy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/transcribe-policy.ts packages/core/test/pipeline/transcribe-policy.test.ts
git commit -m "feat(core): pure transcribePolicy decision function"
```

## Task B3: transcribe queue — budget, constants, enqueue, registration, dispatchers

**Files:**
- Modify: `packages/core/src/queue/queues.ts`
- Modify: `packages/core/src/queue/loop.ts`, `packages/core/src/queue/batch.ts`
- Test: `packages/core/test/queue/transcribe-budget.test.ts`, `packages/core/test/queue/transcribe-queue.int.test.ts`

**Interfaces:**
- Consumes: `runTranscribe`, `handleTranscribeDeadLetter` (Task B4 — forward reference; loop/batch import them).
- Produces:
  - `TRANSCRIBE_QUEUE = 'transcribe'`, `TRANSCRIBE_DEAD_LETTER = 'transcribe-failed'`
  - `interface TranscribeJob { itemId: string }`
  - `TRANSCRIBE_TIME_FACTOR = 2`, `TRANSCRIBE_FIXED_OVERHEAD_SEC = 900`, `TRANSCRIBE_EXPIRY_BACKSTOP_SEC` (= `transcribeBudgetSec(43200)`)
  - `transcribeBudgetSec(durationSec: number): number`
  - `enqueueTranscribe(boss, itemId, opts: { durationSec: number }): Promise<void>`

- [ ] **Step 1: Write the failing budget test**

```ts
// packages/core/test/queue/transcribe-budget.test.ts
import { describe, expect, test } from 'vitest';
import { transcribeBudgetSec, TRANSCRIBE_FIXED_OVERHEAD_SEC } from '../../src/queue/queues.js';

describe('transcribeBudgetSec', () => {
  test('a 0s audio still gets at least the fixed overhead', () => {
    expect(transcribeBudgetSec(0)).toBe(TRANSCRIBE_FIXED_OVERHEAD_SEC);
  });
  test('monotonic increasing in durationSec', () => {
    expect(transcribeBudgetSec(600)).toBeLessThan(transcribeBudgetSec(601));
    expect(transcribeBudgetSec(60)).toBeLessThan(transcribeBudgetSec(3600));
  });
  test('includes the 2x factor over the audio length', () => {
    expect(transcribeBudgetSec(1000)).toBe(2000 + TRANSCRIBE_FIXED_OVERHEAD_SEC);
  });
  test('is never equal to the audio length alone (decision #6)', () => {
    expect(transcribeBudgetSec(10800)).not.toBe(10800);
  });
});
```

- [ ] **Step 2: Run it — confirm it fails**

Run: `pnpm --filter @benkyou/core test transcribe-budget`
Expected: FAIL.

- [ ] **Step 3: Add constants + budget + enqueue to `queues.ts`**

```ts
export const TRANSCRIBE_QUEUE = 'transcribe';
export const TRANSCRIBE_DEAD_LETTER = 'transcribe-failed';
export interface TranscribeJob { itemId: string }

export const TRANSCRIBE_TIME_FACTOR = 2;           // download + ffmpeg + concurrent Whisper wall-time
export const TRANSCRIBE_FIXED_OVERHEAD_SEC = 900;  // connection setup, first-byte latency, ffmpeg spin-up

// Processing wall-time budget — NOT the audio length, and never = video_manual_limit (decision #6).
export function transcribeBudgetSec(durationSec: number): number {
  return Math.ceil(durationSec * TRANSCRIBE_TIME_FACTOR) + TRANSCRIBE_FIXED_OVERHEAD_SEC;
}

// Queue-wide backstop only (sized for a worst-case ~12h job); the real budget is per-job.
export const TRANSCRIBE_EXPIRY_BACKSTOP_SEC = transcribeBudgetSec(43_200);

export async function enqueueTranscribe(
  boss: PgBoss, itemId: string, opts: { durationSec: number },
): Promise<void> {
  // singletonKey makes a redelivered extract's re-enqueue a no-op while a transcribe
  // job for this item is still live — an expensive stage must not double-bill Whisper.
  await boss.send(TRANSCRIBE_QUEUE, { itemId } satisfies TranscribeJob, {
    expireInSeconds: transcribeBudgetSec(opts.durationSec),
    singletonKey: itemId,
  });
}
```

> **Verify (decision #6 caveat):** confirm pg-boss 12 honors per-`send` `expireInSeconds` over the queue policy default. If a quick integration probe shows it does NOT, fall back to a queue-wide `expireInSeconds: TRANSCRIBE_EXPIRY_BACKSTOP_SEC` and document it — still a wall-time budget with a safety factor, never `= video_manual_limit`.

- [ ] **Step 4: Register the transcribe queue + dead-letter in `registerQueues`**

After the `PER_ITEM_STAGES` loop in `registerQueues`:
```ts
  await boss.createQueue(TRANSCRIBE_DEAD_LETTER);
  const transcribePolicy = {
    retryLimit: 2, retryBackoff: true,
    deadLetter: TRANSCRIBE_DEAD_LETTER,
    expireInSeconds: TRANSCRIBE_EXPIRY_BACKSTOP_SEC,
  };
  await boss.createQueue(TRANSCRIBE_QUEUE, transcribePolicy);
  await boss.updateQueue(TRANSCRIBE_QUEUE, transcribePolicy);
```

- [ ] **Step 5: Write the failing queue-registration integration test**

```ts
// packages/core/test/queue/transcribe-queue.int.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import type { PgBoss } from 'pg-boss';

describe('transcribe queue registration', () => {
  let db: TestDatabase; let boss: PgBoss;
  let registerQueues: (b: PgBoss) => Promise<void>;
  let closeBoss: () => Promise<void>; let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('queue/transcribe-queue.int.test');
    const q = await import('../../src/queue/index.js');
    registerQueues = q.registerQueues; closeBoss = q.closeBoss; boss = await q.getBoss();
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  test('transcribe queue has retryLimit 2 + its own dead-letter, independent of pipeline_max_attempts', async () => {
    await registerQueues(boss);
    const q = await boss.getQueue('transcribe');
    expect(q?.retryLimit).toBe(2);
    expect(q?.deadLetter).toBe('transcribe-failed');
    const dl = await boss.getQueue('transcribe-failed');
    expect(dl).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run it — confirm it passes**

Run: `pnpm --filter @benkyou/core test transcribe-queue transcribe-budget`
Expected: PASS.

- [ ] **Step 7: Wire both dispatchers (forward-imports `runTranscribe`/`handleTranscribeDeadLetter` from Task B4)**

In `queue/loop.ts`, after the dead-letter worker, add:
```ts
  await boss.work<TranscribeJob>(TRANSCRIBE_QUEUE, async ([job]) => {
    if (job) await runTranscribe(boss, job.data);
  });
  await boss.work<TranscribeJob>(TRANSCRIBE_DEAD_LETTER, async ([job]) => {
    if (job) await handleTranscribeDeadLetter(boss, job.data);
  });
```
Import `TRANSCRIBE_QUEUE`, `TRANSCRIBE_DEAD_LETTER`, `type TranscribeJob` from `./queues` and `runTranscribe`, `handleTranscribeDeadLetter` from `./runner`.

In `queue/batch.ts`, change the drain order to interleave transcribe **after extract, before embed**:
```ts
const queues = [
  INGEST_QUEUE, 'extract', TRANSCRIBE_QUEUE, TRANSCRIBE_DEAD_LETTER,
  'embed', 'score', 'dedup', 'summary', DEAD_LETTER_QUEUE,
] as const;
```
In the per-job branch, add:
```ts
          else if (queue === TRANSCRIBE_QUEUE) await runTranscribe(boss, job.data as TranscribeJob);
          else if (queue === TRANSCRIBE_DEAD_LETTER) await handleTranscribeDeadLetter(boss, job.data as TranscribeJob);
```
(Inert under serverless — policy short-circuits to `skipped_serverless` before any enqueue — but wired for symmetry.)

- [ ] **Step 8: Commit (compiles only after B4 lands — note in message)**

```bash
git add packages/core/src/queue packages/core/test/queue
git commit -m "feat(core): transcribe queue, per-job budget, dual-dispatcher wiring"
```
> If executing strictly in order, do B4's `runner.ts` additions in the same working tree before running `pnpm typecheck` (loop/batch import them). The subagent-driven flow lands B3+B4 as adjacent tasks; keep them together for a green typecheck.

## Task B4: transcribe runner — store ops, `runTranscribe`, terminal, advance

**Files:**
- Create: `packages/core/src/pipeline/transcribe-store.ts`
- Modify: `packages/core/src/queue/runner.ts`
- Modify: `packages/core/src/pipeline/index.ts` (export store ops + the engine type once B6 lands)
- Test: `packages/core/test/queue/transcribe-runner.int.test.ts`

**Interfaces:**
- Consumes: `transcribeItem` (Task B6 engine — signature below), `enqueueStage`, `recordFailure`.
- Produces:
  - `getTranscribeView(itemId): Promise<TranscribeView | undefined>` where
    `TranscribeView = { id: string; state: string; transcriptStatus: string; mediaUrl: string | null; url: string; durationSec: number | null; isAdhoc: boolean }`
  - `writeTranscript(itemId, { segments, flatText, durationSec }): Promise<void>` (sets `transcript_status='present'`)
  - `setTranscriptStatus(itemId, status): Promise<void>`
  - `advancePendingToExtracted(itemId): Promise<boolean>` (guarded UPDATE; writes `current_stage='embed'`)
  - `runTranscribe(boss, job): Promise<void>`, `handleTranscribeDeadLetter(boss, job): Promise<void>`

- [ ] **Step 1: Implement the store ops**

```ts
// packages/core/src/pipeline/transcribe-store.ts
import { and, eq, sql } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import type { TranscriptSegment } from '../sources/types';

export interface TranscribeView {
  id: string; state: string; transcriptStatus: string;
  mediaUrl: string | null; url: string; durationSec: number | null; isAdhoc: boolean;
}

export async function getTranscribeView(itemId: string): Promise<TranscribeView | undefined> {
  const db = getDbClient();
  const rows = await db
    .select({
      id: items.id, state: items.state, transcriptStatus: items.transcriptStatus,
      mediaUrl: items.mediaUrl, url: items.url, durationSec: items.videoDuration, sourceId: items.sourceId,
    })
    .from(items).where(eq(items.id, itemId)).limit(1);
  const r = rows[0];
  if (!r) return undefined;
  return { ...r, isAdhoc: r.sourceId == null };
}

export async function writeTranscript(
  itemId: string, data: { segments: TranscriptSegment[]; flatText: string; durationSec: number },
): Promise<void> {
  const db = getDbClient();
  await db.update(items).set({
    transcriptStatus: 'present',
    transcriptSegments: data.segments,
    rawContent: data.flatText,
    videoDuration: data.durationSec,
    updatedAt: sql`now()`,
  }).where(eq(items.id, itemId));
}

export async function setTranscriptStatus(itemId: string, status: string): Promise<void> {
  const db = getDbClient();
  await db.update(items).set({ transcriptStatus: status, updatedAt: sql`now()` }).where(eq(items.id, itemId));
}

// Conditional advance guarded on state='pending' so a redelivered success OR a
// dead-letter re-run is a no-op. This is the ONLY place current_stage leaves 'extract'
// for a transcribed item (decision #7). Mirrors completeStage's reset of attempts/error.
export async function advancePendingToExtracted(itemId: string): Promise<boolean> {
  const db = getDbClient();
  const rows = await db.update(items).set({
    state: 'extracted', currentStage: 'embed', attempts: 0, lastError: null, updatedAt: sql`now()`,
  }).where(and(eq(items.id, itemId), eq(items.state, 'pending'))).returning({ id: items.id });
  return rows.length > 0;
}
```

- [ ] **Step 2: Add runner functions to `queue/runner.ts`**

```ts
import { TRANSCRIBE_QUEUE, TRANSCRIBE_DEAD_LETTER, type TranscribeJob } from './queues';
import { getTranscribeView, writeTranscript, setTranscriptStatus, advancePendingToExtracted } from '../pipeline/transcribe-store';
import { transcribeItem } from '../pipeline/transcribe';

export async function runTranscribe(boss: PgBoss, { itemId }: TranscribeJob): Promise<void> {
  const item = await getTranscribeView(itemId);
  // Own at-least-once guard: drop a redelivered/out-of-order job.
  if (item?.state !== 'pending' || item.transcriptStatus !== 'pending') return;
  try {
    const { segments, flatText, durationSec } = await transcribeItem(item);
    await writeTranscript(itemId, { segments, flatText, durationSec });
    await advanceAfterTranscribe(boss, itemId);
  } catch (err) {
    await recordFailure(itemId, err); // last_error only; state untouched
    throw err;                        // retryLimit=2 → TRANSCRIBE_DEAD_LETTER
  }
}

// Terminal: degrade + CONTINUE (never markFailed — that handler sets state='failed').
export async function handleTranscribeDeadLetter(boss: PgBoss, { itemId }: TranscribeJob): Promise<void> {
  await setTranscriptStatus(itemId, 'unavailable'); // raw_content stays title/show-notes only
  await advanceAfterTranscribe(boss, itemId);
}

async function advanceAfterTranscribe(boss: PgBoss, itemId: string): Promise<void> {
  const advanced = await advancePendingToExtracted(itemId);
  if (advanced) await enqueueStage(boss, 'embed', itemId);
}
```
Export `runTranscribe`, `handleTranscribeDeadLetter`. Add the store-op + engine re-exports to `pipeline/index.ts`.

- [ ] **Step 3: Write the failing runner integration test (mock the engine)**

```ts
// packages/core/test/queue/transcribe-runner.int.test.ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';
import type { PgBoss } from 'pg-boss';

vi.mock('../../src/pipeline/transcribe.js', () => ({
  transcribeItem: vi.fn(async () => ({
    segments: [{ start: 0, end: 2, text: 'hi' }], flatText: 'hi', durationSec: 120,
  })),
}));

describe('runTranscribe + terminal', () => {
  let db: TestDatabase; let sql: postgres.Sql; let boss: PgBoss;
  let runTranscribe: (b: PgBoss, j: { itemId: string }) => Promise<void>;
  let handleTranscribeDeadLetter: (b: PgBoss, j: { itemId: string }) => Promise<void>;
  let registerQueues: (b: PgBoss) => Promise<void>;
  let closeBoss: () => Promise<void>; let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('queue/transcribe-runner.int.test'); sql = db.sql;
    const q = await import('../../src/queue/index.js');
    runTranscribe = q.runTranscribe; handleTranscribeDeadLetter = q.handleTranscribeDeadLetter;
    registerQueues = q.registerQueues; closeBoss = q.closeBoss; boss = await q.getBoss();
    await registerQueues(boss);
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  async function seed(transcriptStatus = 'pending'): Promise<string> {
    const r = await sql<{ id: string }[]>`
      INSERT INTO items (url, url_hash, title, content_type, media_url, video_duration, transcript_status, state, current_stage)
      VALUES ('https://cdn/'||gen_random_uuid()||'.mp3', gen_random_uuid()::text, 'T', 'audio', 'https://cdn/a.mp3', 120, ${transcriptStatus}, 'pending', 'extract')
      RETURNING id`;
    return r[0]!.id;
  }

  test('success writes transcript, advances pending→extracted, current_stage=embed', async () => {
    const id = await seed();
    await runTranscribe(boss, { itemId: id });
    const r = await sql<{ state: string; current_stage: string; transcript_status: string; raw_content: string }[]>`
      SELECT state, current_stage, transcript_status, raw_content FROM items WHERE id=${id}`;
    expect(r[0]).toMatchObject({ state: 'extracted', current_stage: 'embed', transcript_status: 'present', raw_content: 'hi' });
  });

  test('guard drops a job whose transcript_status is not pending', async () => {
    const id = await seed('present');
    await runTranscribe(boss, { itemId: id });
    const r = await sql<{ state: string }[]>`SELECT state FROM items WHERE id=${id}`;
    expect(r[0]!.state).toBe('pending'); // untouched
  });

  test('dead-letter degrades to unavailable + extracted + current_stage=embed (NOT failed)', async () => {
    const id = await seed();
    await handleTranscribeDeadLetter(boss, { itemId: id });
    const r = await sql<{ state: string; current_stage: string; transcript_status: string }[]>`
      SELECT state, current_stage, transcript_status FROM items WHERE id=${id}`;
    expect(r[0]).toEqual({ state: 'extracted', current_stage: 'embed', transcript_status: 'unavailable' });
  });

  test('redelivered dead-letter is a no-op (already advanced)', async () => {
    const id = await seed();
    await handleTranscribeDeadLetter(boss, { itemId: id });
    await handleTranscribeDeadLetter(boss, { itemId: id }); // second delivery
    const r = await sql<{ state: string }[]>`SELECT state FROM items WHERE id=${id}`;
    expect(r[0]!.state).toBe('extracted');
  });
});
```

- [ ] **Step 4: Run it — confirm it passes**

Run: `pnpm --filter @benkyou/core test transcribe-runner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/transcribe-store.ts packages/core/src/queue/runner.ts packages/core/src/pipeline/index.ts packages/core/test/queue/transcribe-runner.int.test.ts
git commit -m "feat(core): transcribe runner, terminal degrade-and-continue, guarded advance"
```

## Task B5: media probe + guarded download (`media-probe.ts`)

**Files:**
- Create: `packages/core/src/pipeline/media-probe.ts`
- Test: `packages/core/test/pipeline/media-probe.test.ts`

**Interfaces:**
- Produces:
  - `const TRANSCRIBE_MAX_BYTES = 2 * 1024 * 1024 * 1024` (code constant — generous runaway/mislabeled-content guard, NOT a settings column)
  - `assertHttpUrl(rawUrl: string): URL` — throws on scheme ∉ {http, https}
  - `probeRemoteDurationSec(mediaUrl: string): Promise<number | null>` (remote ffprobe; null = resolved-but-not-media; throws on transient failure)
  - `downloadToTmp(mediaUrl: string): Promise<{ path: string; cleanup: () => Promise<void> }>` (streaming, byte-ceiling abort)

- [ ] **Step 1: Write the failing guard tests (pure parts)**

```ts
// packages/core/test/pipeline/media-probe.test.ts
import { describe, expect, test } from 'vitest';
import { assertHttpUrl, TRANSCRIBE_MAX_BYTES } from '../../src/pipeline/media-probe.js';

describe('media-probe guards', () => {
  test('accepts http and https', () => {
    expect(assertHttpUrl('http://x/a.mp3').protocol).toBe('http:');
    expect(assertHttpUrl('https://x/a.mp3').protocol).toBe('https:');
  });
  test('rejects file: and other schemes', () => {
    expect(() => assertHttpUrl('file:///etc/passwd')).toThrow();
    expect(() => assertHttpUrl('ftp://x/a.mp3')).toThrow();
    expect(() => assertHttpUrl('not a url')).toThrow();
  });
  test('byte ceiling is a generous multi-GB constant', () => {
    expect(TRANSCRIBE_MAX_BYTES).toBeGreaterThanOrEqual(1024 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run it — confirm it fails**

Run: `pnpm --filter @benkyou/core test media-probe`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `media-probe.ts`**

```ts
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const TRANSCRIBE_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB runaway/mislabeled-content guard
const PROBE_TIMEOUT_MS = 30_000;

export function assertHttpUrl(rawUrl: string): URL {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error(`Invalid media URL: ${rawUrl}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Refusing non-http(s) media URL scheme: ${u.protocol}`);
  }
  return u;
}

// ffprobe reads only headers / the moov atom (a few hundred KB) over the network.
// Returns null when the URL resolves but is not parseable media (→ caller degrades to
// unavailable). Throws on a transient failure (→ caller's extract retry consumes attempts).
export function probeRemoteDurationSec(mediaUrl: string): Promise<number | null> {
  assertHttpUrl(mediaUrl);
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error', '-probesize', '5M', '-analyzeduration', '5M',
      '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mediaUrl,
    ];
    const proc = spawn('ffprobe', args, { timeout: PROBE_TIMEOUT_MS });
    let out = ''; let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject); // ffprobe binary missing → transient/infra error
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 500)}`));
      const secs = Number(out.trim());
      resolve(Number.isFinite(secs) && secs > 0 ? Math.round(secs) : null);
    });
  });
}

// Streaming download with a hard byte ceiling that aborts even if Content-Length lied.
// Scheme allowlist + redirect cap. Caller MUST call cleanup() in finally.
export async function downloadToTmp(mediaUrl: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  assertHttpUrl(mediaUrl);
  const res = await fetch(mediaUrl, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Media download failed: ${res.status} ${res.statusText}`);
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > TRANSCRIBE_MAX_BYTES) {
    throw new Error(`Media exceeds byte ceiling (Content-Length ${declared} > ${TRANSCRIBE_MAX_BYTES})`);
  }
  const dir = await mkdtemp(join(tmpdir(), 'benkyou-transcribe-'));
  const path = join(dir, 'media');
  const cleanup = async (): Promise<void> => { await rm(dir, { recursive: true, force: true }); };
  try {
    let total = 0;
    const counting = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > TRANSCRIBE_MAX_BYTES) throw new Error(`Media stream exceeded byte ceiling at ${total} bytes`);
        controller.enqueue(chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counting)), createWriteStream(path));
    return { path, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
```

- [ ] **Step 4: Add a streaming-abort integration test (fake oversized body)**

```ts
// append to media-probe.test.ts
import { downloadToTmp } from '../../src/pipeline/media-probe.js';
import { vi } from 'vitest';

test('streaming download aborts when the body exceeds the ceiling despite a small Content-Length', async () => {
  const huge = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(64 * 1024 * 1024)); }, // never ends
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(huge, { status: 200, headers: { 'content-length': '10' } }),
  );
  await expect(downloadToTmp('https://cdn/a.mp3')).rejects.toThrow(/byte ceiling/);
  vi.restoreAllMocks();
});
```
(Lower `TRANSCRIBE_MAX_BYTES`'s effective bite by enqueuing >2 GiB across pulls is slow; instead set the test to expect the ceiling error by having the fake stream enqueue chunks until it trips — to keep it fast, the reviewer may temporarily assert against a smaller injected ceiling via a parameter. If `downloadToTmp` is given an optional `maxBytes` param defaulting to `TRANSCRIBE_MAX_BYTES`, pass `maxBytes: 1024` here for a fast trip. Add that optional param.)

Adjust `downloadToTmp` signature to `downloadToTmp(mediaUrl: string, maxBytes = TRANSCRIBE_MAX_BYTES)` and use `maxBytes` in both checks; pass `1024` in the test.

- [ ] **Step 5: Run it — confirm it passes**

Run: `pnpm --filter @benkyou/core test media-probe`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline/media-probe.ts packages/core/test/pipeline/media-probe.test.ts
git commit -m "feat(core): remote ffprobe + guarded streaming media download"
```

## Task B6: transcribe engine + Whisper client

**Files:**
- Modify: `packages/core/package.json` (add `p-limit`)
- Create: `packages/core/src/ai/whisper.ts`
- Create: `packages/core/src/pipeline/transcribe.ts`
- Modify: `Dockerfile.worker` (add ffmpeg)
- Test: `packages/core/test/pipeline/transcribe-merge.test.ts`, `packages/core/test/ai/whisper.int.test.ts`

**Interfaces:**
- Consumes: `downloadToTmp`, `probeRemoteDurationSec` (B5); `recordUsage` (A2); `buildWhisperConfig`/settings; `TranscribeView` (B4).
- Produces:
  - `planChunks(durationSec: number): { index: number; start: number; end: number }[]` (10-min windows, 5-s overlap)
  - `mergeSegments(chunks: { start: number; segments: TranscriptSegment[] }[]): TranscriptSegment[]` (absolute-time offset + overlap dedup)
  - `transcribeItem(item: TranscribeView): Promise<{ segments: TranscriptSegment[]; flatText: string; durationSec: number }>`
  - `transcribeRecorded(args: { cfg: WhisperConfig; ctx: UsageContext; file: Blob; durationSec: number }): Promise<{ segments: TranscriptSegment[] }>` in `whisper.ts`

- [ ] **Step 1: Add `p-limit` + ffmpeg**

```bash
pnpm --filter @benkyou/core add p-limit
```
In `Dockerfile.worker`, after `WORKDIR /app` in the `runtime` stage (alpine), add:
```dockerfile
RUN apk add --no-cache ffmpeg
```
(ffprobe ships with the ffmpeg package. The web image stays ffmpeg-free.)

- [ ] **Step 2: Write the failing merge/chunk test (pure)**

```ts
// packages/core/test/pipeline/transcribe-merge.test.ts
import { describe, expect, test } from 'vitest';
import { planChunks, mergeSegments } from '../../src/pipeline/transcribe.js';

describe('planChunks', () => {
  test('single window for short audio', () => {
    expect(planChunks(300)).toEqual([{ index: 0, start: 0, end: 300 }]);
  });
  test('10-min windows with 5s overlap', () => {
    const c = planChunks(1500); // 25 min
    expect(c[0]).toEqual({ index: 0, start: 0, end: 600 });
    expect(c[1]!.start).toBe(595); // 5s overlap back
    expect(c.at(-1)!.end).toBe(1500);
  });
});

describe('mergeSegments', () => {
  test('offsets each chunk by its start (absolute timestamps)', () => {
    const merged = mergeSegments([
      { start: 0, segments: [{ start: 0, end: 2, text: 'a' }] },
      { start: 595, segments: [{ start: 0, end: 3, text: 'b' }] },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 2, text: 'a' },
      { start: 595, end: 598, text: 'b' },
    ]);
  });
  test('drops later-chunk segments starting before the previous chunk effective end (overlap dedup)', () => {
    const merged = mergeSegments([
      { start: 0, segments: [{ start: 0, end: 600, text: 'a' }] },
      // absolute start 595+2=597 < 600 → dropped; 595+8=603 ≥ 600 → kept
      { start: 595, segments: [{ start: 2, end: 6, text: 'dup' }, { start: 8, end: 12, text: 'keep' }] },
    ]);
    expect(merged.map((s) => s.text)).toEqual(['a', 'keep']);
  });
});
```

- [ ] **Step 3: Run it — confirm it fails**

Run: `pnpm --filter @benkyou/core test transcribe-merge`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement the pure helpers + engine skeleton in `transcribe.ts`**

```ts
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import pLimit from 'p-limit';
import type { TranscriptSegment } from '../sources/types';
import type { TranscribeView } from './transcribe-store';
import { downloadToTmp, probeRemoteDurationSec } from './media-probe';
import { transcribeRecorded } from '../ai/whisper';
import { buildWhisperConfig, getUserSettings } from '../settings';

const WINDOW_SEC = 600;   // 10-min chunks keep each upload under the 25 MB Whisper limit
const OVERLAP_SEC = 5;
const WHISPER_CONCURRENCY = 3; // unbounded Promise.all on ~18 chunks trips endpoint rate limits

export function planChunks(durationSec: number): { index: number; start: number; end: number }[] {
  if (durationSec <= WINDOW_SEC) return [{ index: 0, start: 0, end: Math.max(durationSec, 0) }];
  const out: { index: number; start: number; end: number }[] = [];
  let start = 0; let index = 0;
  while (start < durationSec) {
    const end = Math.min(start + WINDOW_SEC, durationSec);
    out.push({ index, start, end });
    if (end >= durationSec) break;
    index += 1;
    start = end - OVERLAP_SEC;
  }
  return out;
}

// Merge by ABSOLUTE timestamp. Offset each chunk's segments by its start; in the overlap
// region drop later-chunk segments whose absolute start falls before the previous chunk's
// effective end. v1 does NO fuzzy text alignment (spec §5.5).
export function mergeSegments(
  chunks: { start: number; segments: TranscriptSegment[] }[],
): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let prevEnd = 0;
  for (const chunk of chunks) {
    for (const seg of chunk.segments) {
      const abs = { ...seg, start: seg.start + chunk.start, end: seg.end + chunk.start };
      if (abs.start < prevEnd) continue; // overlap duplicate
      out.push(abs);
    }
    if (out.length) prevEnd = out[out.length - 1]!.end;
  }
  return out;
}

function ffmpegSliceToOgg(srcPath: string, start: number, end: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error', '-ss', String(start), '-to', String(end), '-i', srcPath,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-f', 'ogg', 'pipe:1',
    ];
    const proc = spawn('ffmpeg', args);
    const bufs: Buffer[] = []; let err = '';
    proc.stdout.on('data', (d) => bufs.push(d));
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve(Buffer.concat(bufs)) : reject(new Error(`ffmpeg ${code}: ${err.slice(0, 500)}`)));
  });
}

export async function transcribeItem(
  item: TranscribeView,
): Promise<{ segments: TranscriptSegment[]; flatText: string; durationSec: number }> {
  const settings = await getUserSettings();
  if (!settings) throw new Error('user_settings not initialized');
  const cfg = buildWhisperConfig(settings);

  const source = item.mediaUrl ?? item.url;
  const durationSec = item.durationSec ?? (await probeRemoteDurationSec(source)) ?? 0;
  if (durationSec <= 0) throw new Error('Could not resolve audio duration for transcription');

  const { path, cleanup } = await downloadToTmp(source);
  try {
    const plan = planChunks(durationSec);
    const limit = pLimit(WHISPER_CONCURRENCY);
    const results = await Promise.all(
      plan.map((c) => limit(async () => {
        const buf = await ffmpegSliceToOgg(path, c.start, c.end);
        const { segments } = await transcribeRecorded({
          cfg, ctx: { stage: 'transcribe', itemId: item.id },
          file: new Blob([buf], { type: 'audio/ogg' }),
          durationSec: c.end - c.start,
        });
        return { start: c.start, segments };
      })),
    );
    const segments = mergeSegments(results);
    const flatText = segments.map((s) => s.text.trim()).filter(Boolean).join(' ');
    return { segments, flatText, durationSec };
  } finally {
    await cleanup();
  }
}
```
> `readFile` import is unused if you stream the slice via pipe (as above) — drop it. Keep the engine free of `recordUsage`: usage is recorded by `transcribeRecorded` per chunk.

- [ ] **Step 5: Run the merge test — confirm it passes**

Run: `pnpm --filter @benkyou/core test transcribe-merge`
Expected: PASS.

- [ ] **Step 6: Implement the Whisper client + `buildWhisperConfig`**

In `packages/core/src/settings/index.ts` add:
```ts
export interface WhisperConfig { baseUrl: string; apiKey?: string; model: string; }
export function buildWhisperConfig(s: UserSettings): WhisperConfig {
  if (!s.whisperBaseUrl || !s.whisperModel) {
    throw new Error('Whisper not configured (whisper_base_url / whisper_model missing in user_settings)');
  }
  return { baseUrl: s.whisperBaseUrl, apiKey: s.whisperApiKey ?? undefined, model: s.whisperModel };
}
```

Create `packages/core/src/ai/whisper.ts`:
```ts
import type { TranscriptSegment } from '../sources/types';
import type { WhisperConfig } from '../settings';
import { recordUsage, type UsageContext } from './usage';

interface VerboseJson {
  segments?: { start: number; end: number; text: string; speaker?: string }[];
  text?: string;
}

// OpenAI Whisper-API-compatible POST /audio/transcriptions, multipart form.
// verbose_json yields per-segment timestamps; endpoints without them degrade to a
// single chunk-granular segment. speaker is filled only when the endpoint returns it.
export async function transcribeChunk(
  cfg: WhisperConfig, file: Blob, chunkSeconds: number,
): Promise<TranscriptSegment[]> {
  const form = new FormData();
  form.set('file', file, 'chunk.ogg');
  form.set('model', cfg.model);
  form.set('response_format', 'verbose_json');
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : undefined,
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper transcription failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as VerboseJson;
  if (json.segments?.length) {
    return json.segments.map((s) => ({
      start: s.start, end: s.end, text: s.text,
      ...(s.speaker ? { speaker: s.speaker } : {}),
    }));
  }
  // No timestamps → one chunk-granular segment spanning the whole chunk.
  return [{ start: 0, end: chunkSeconds, text: (json.text ?? '').trim() }];
}

export async function transcribeRecorded(args: {
  cfg: WhisperConfig; ctx: UsageContext; file: Blob; durationSec: number;
}): Promise<{ segments: TranscriptSegment[] }> {
  const segments = await transcribeChunk(args.cfg, args.file, args.durationSec);
  await recordUsage(args.ctx, {
    kind: 'transcription', model: args.cfg.model,
    inputTokens: null, outputTokens: null, totalTokens: null, durationSeconds: args.durationSec,
  });
  return { segments };
}
```
Export `whisper.ts` from `ai/index.ts`.

- [ ] **Step 7: Write the failing Whisper-record test (mock fetch)**

```ts
// packages/core/test/ai/whisper.int.test.ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('transcribeRecorded', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let transcribeRecorded: typeof import('../../src/ai/whisper.js').transcribeRecorded;
  let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('ai/whisper.int.test'); sql = db.sql;
    ({ transcribeRecorded } = await import('../../src/ai/whisper.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeDbClient?.(); await db?.cleanup(); });

  test('records one transcription row with duration_seconds and no tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ segments: [{ start: 0, end: 5, text: 'hello' }] }), { status: 200 }),
    );
    const { segments } = await transcribeRecorded({
      cfg: { baseUrl: 'https://w', model: 'whisper-1' },
      ctx: { stage: 'transcribe', itemId: null },
      file: new Blob([new Uint8Array(4)]), durationSec: 300,
    });
    expect(segments).toEqual([{ start: 0, end: 5, text: 'hello' }]);
    const r = await sql<{ kind: string; duration_seconds: number; total_tokens: number | null }[]>`
      SELECT kind, duration_seconds, total_tokens FROM ai_usage WHERE stage='transcribe'`;
    expect(r).toEqual([{ kind: 'transcription', duration_seconds: 300, total_tokens: null }]);
    vi.restoreAllMocks();
  });

  test('falls back to a single chunk-granular segment when no timestamps', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: 'plain' }), { status: 200 }),
    );
    const { segments } = await transcribeRecorded({
      cfg: { baseUrl: 'https://w', model: 'whisper-1' },
      ctx: { stage: 'transcribe', itemId: null }, file: new Blob([new Uint8Array(4)]), durationSec: 120,
    });
    expect(segments).toEqual([{ start: 0, end: 120, text: 'plain' }]);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 8: Run it — confirm it passes**

Run: `pnpm --filter @benkyou/core test whisper`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/ai/whisper.ts packages/core/src/pipeline/transcribe.ts packages/core/src/settings/index.ts packages/core/src/ai/index.ts Dockerfile.worker packages/core/test
git commit -m "feat(core): whisper client + transcribe engine (chunk/merge/concurrent)"
```

## Task B7: runner seam + extract media handoff + direct-media paste

**Files:**
- Modify: `packages/core/src/pipeline/state.ts` (`StageOutcome`)
- Modify: `packages/core/src/queue/runner.ts` (`runItemStage` seam)
- Modify: `packages/core/src/pipeline/index.ts` (`STAGE_HANDLERS` return type)
- Modify: `packages/core/src/pipeline/extract.ts` (media branch)
- Modify: `packages/core/src/sources/resolve.ts` (direct-media detection)
- Modify: `packages/core/src/items/paste.ts` (set media_url + audio/video content_type)
- Test: `packages/core/test/queue/runner-seam.int.test.ts`, `packages/core/test/pipeline/extract-media.int.test.ts`

**Interfaces:**
- Consumes: `transcribePolicy` (B2), `enqueueTranscribe` (B3), `probeRemoteDurationSec` (B5), `setTranscriptStatus` (B4), env `DEPLOY_MODE`.
- Produces:
  - `type StageOutcome = { advance: boolean }`
  - `STAGE_HANDLERS: Record<PerItemStage, (itemId: string) => Promise<void | StageOutcome>>`
  - `extractItem` returns `StageOutcome | void`
  - `detectAdhocMedia(url: string): { contentType: 'audio' | 'video' } | null`

- [ ] **Step 1: Add `StageOutcome` + the runner seam**

In `pipeline/state.ts`:
```ts
// Handlers may hand off without advancing (e.g. extract enqueuing transcribe). Default = advance.
export type StageOutcome = { advance: boolean };
```

In `queue/runner.ts` `runItemStage`, replace the try/complete block:
```ts
  await beginStage(itemId, stage);
  let outcome: StageOutcome;
  try {
    outcome = (await STAGE_HANDLERS[stage](itemId)) ?? { advance: true };
  } catch (err) {
    await recordFailure(itemId, err);
    throw err;
  }
  if (!outcome.advance) return; // handler handed off; it owns the next advance
  await completeStage(itemId, stage);
  const next = NEXT_STAGE[stage];
  if (next) await enqueueStage(boss, next, itemId);
```
Import `type StageOutcome` from `../pipeline/state`. In `pipeline/index.ts` change the `STAGE_HANDLERS` type to `Record<PerItemStage, (itemId: string) => Promise<void | StageOutcome>>` and import `type StageOutcome`.

- [ ] **Step 2: Write the failing runner-seam test (a fake handler that hands off)**

```ts
// packages/core/test/queue/runner-seam.int.test.ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';
import type { PgBoss } from 'pg-boss';

// Make extract hand off; other stages stay void.
vi.mock('../../src/pipeline/extract.js', () => ({ extractItem: vi.fn(async () => ({ advance: false })) }));

describe('runItemStage deferred-advancement seam', () => {
  let db: TestDatabase; let sql: postgres.Sql; let boss: PgBoss;
  let runItemStage: (b: PgBoss, j: { itemId: string; stage: string }) => Promise<void>;
  let registerQueues: (b: PgBoss) => Promise<void>;
  let closeBoss: () => Promise<void>; let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('queue/runner-seam.int.test'); sql = db.sql;
    const q = await import('../../src/queue/index.js');
    runItemStage = q.runItemStage as never; registerQueues = q.registerQueues; closeBoss = q.closeBoss; boss = await q.getBoss();
    await registerQueues(boss);
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  test('extract handoff parks the item at pending with current_stage=extract (not advanced)', async () => {
    const r = await sql<{ id: string }[]>`
      INSERT INTO items (url,url_hash,title,content_type,state,current_stage)
      VALUES ('https://x/a', gen_random_uuid()::text,'T','audio','pending','extract') RETURNING id`;
    await runItemStage(boss, { itemId: r[0]!.id, stage: 'extract' });
    const after = await sql<{ state: string; current_stage: string }[]>`SELECT state,current_stage FROM items WHERE id=${r[0]!.id}`;
    expect(after[0]).toEqual({ state: 'pending', current_stage: 'extract' });
  });
});
```

- [ ] **Step 3: Run it — confirm it passes after the seam edit**

Run: `pnpm --filter @benkyou/core test runner-seam`
Expected: PASS (state untouched, no advance).

- [ ] **Step 4: Add direct-media detection in `resolve.ts`**

```ts
const MEDIA_EXT: Record<string, 'audio' | 'video'> = {
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', flac: 'audio', aac: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
};
// Direct-media paste: URL whose extension is a known media type. Content-Type confirmation
// happens later via remote ffprobe (no sync probe in the web tier).
export function detectAdhocMedia(url: string): { contentType: 'audio' | 'video' } | null {
  let pathname = '';
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { return null; }
  const ext = pathname.split('.').pop() ?? '';
  const kind = MEDIA_EXT[ext];
  return kind ? { contentType: kind } : null;
}
```

- [ ] **Step 5: Set media fields at paste time**

In `items/paste.ts`, replace `initialContentType` usage:
```ts
import { detectAdhocType, detectAdhocMedia } from '../sources';
// ...
const media = detectAdhocMedia(rawUrl);
const contentType = media ? media.contentType : initialContentType(rawUrl);
// in .values:
      contentType,
      mediaUrl: media ? rawUrl : null, // for direct-media the canonical url IS the download source
```
Keep `initialContentType` for the non-media youtube/bilibili/article branch.

- [ ] **Step 6: Implement the extract media handoff branch**

In `pipeline/extract.ts`, at the top of `extractItem` after loading `item`:
```ts
import { env } from '../config/env';
import { transcribePolicy } from './transcribe-policy';
import { probeRemoteDurationSec } from './media-probe';
import { setTranscriptStatus } from './transcribe-store';
import { getBoss, enqueueTranscribe } from '../queue';
import type { StageOutcome } from './state';

// A media item is transcribe-eligible when it carries a downloadable audio/video source
// and has no usable transcript yet. The article adapter would mangle a raw media URL, so
// these items SKIP the adapter entirely (clarifies the spec's "after the adapter returns":
// podcasts keep their ingest-time show-notes raw_content, paste has none).
function isTranscribeEligible(item: { contentType: string; mediaUrl: string | null; transcriptStatus: string }): boolean {
  return (item.contentType === 'audio' || item.contentType === 'video')
    && item.mediaUrl != null
    && item.transcriptStatus !== 'present';
}
```
Then branch before the adapter resolution:
```ts
  if (isTranscribeEligible(item)) {
    return runMediaHandoff(item);
  }
  // ... existing adapter path unchanged, ending with implicit void (advance) ...
```
Add the handoff function:
```ts
async function runMediaHandoff(item: {
  id: string; url: string; mediaUrl: string | null; videoDuration: number | null; sourceId: string | null;
}): Promise<StageOutcome> {
  const settings = await getUserSettings();
  const source = item.mediaUrl ?? item.url;

  let durationSec = item.videoDuration;
  if (durationSec == null) {
    const probed = await probeRemoteDurationSec(source); // throws transient → extract retry consumes attempts
    if (probed == null) {                                // resolved but not media → degrade + continue
      await setTranscriptStatus(item.id, 'unavailable');
      return { advance: true };
    }
    durationSec = probed;
    await getDbClient().update(items).set({ videoDuration: durationSec }).where(eq(items.id, item.id));
  }

  const decision = transcribePolicy({
    durationSec, isAdhoc: item.sourceId == null,
    deployMode: env.DEPLOY_MODE === 'serverless' ? 'serverless' : 'docker',
    autoLimit: settings?.videoAutoLimit ?? 1800,
    manualLimit: settings?.videoManualLimit ?? 10800,
  });

  if (decision.kind === 'skip') {
    await setTranscriptStatus(item.id, decision.status);
    return { advance: true }; // continue on title/metadata
  }
  if (decision.kind === 'confirm') {
    await setTranscriptStatus(item.id, 'needs_confirmation'); // parks; not stuck (orphan check excludes it)
    return { advance: false };
  }
  // transcribe
  await setTranscriptStatus(item.id, 'pending');
  const boss = await getBoss();
  await enqueueTranscribe(boss, item.id, { durationSec });
  return { advance: false }; // transcribe owns the next advance
}
```
> Confirm `env.DEPLOY_MODE` exists in `config/env.ts`; if the env name differs, use the canonical one. The select in `extractItem` already does `select()` (all columns) so `mediaUrl`/`videoDuration`/`sourceId`/`transcriptStatus` are present on `item`.

- [ ] **Step 7: Write the failing extract-media integration test**

```ts
// packages/core/test/pipeline/extract-media.int.test.ts
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

vi.mock('../../src/pipeline/media-probe.js', async (orig) => ({
  ...(await orig<typeof import('../../src/pipeline/media-probe.js')>()),
  probeRemoteDurationSec: vi.fn(async () => 1200), // 20 min
}));

describe('extract media handoff', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let extractItem: (id: string) => Promise<unknown>;
  let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/extract-media.int.test'); sql = db.sql;
    await sql`INSERT INTO user_settings (id,password_hash,embed_dim,video_auto_limit,video_manual_limit)
      VALUES (1,'x',1536,1800,10800)`;
    // Need queues registered so enqueueTranscribe works.
    const q = await import('../../src/queue/index.js'); await q.registerQueues(await q.getBoss());
    ({ extractItem } = await import('../../src/pipeline/extract.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); await closeDbClient?.(); await db?.cleanup(); });

  async function seedPaste(): Promise<string> {
    const r = await sql<{ id: string }[]>`
      INSERT INTO items (url,url_hash,title,content_type,media_url,state,current_stage,transcript_status)
      VALUES ('https://cdn/a.mp3', gen_random_uuid()::text,'https://cdn/a.mp3','audio','https://cdn/a.mp3','pending','extract','na')
      RETURNING id`;
    return r[0]!.id;
  }

  test('within auto limit → transcript_status pending, item stays pending (hands off)', async () => {
    const id = await seedPaste();
    const outcome = await extractItem(id);
    expect(outcome).toEqual({ advance: false });
    const r = await sql<{ state: string; transcript_status: string; current_stage: string }[]>`
      SELECT state, transcript_status, current_stage FROM items WHERE id=${id}`;
    expect(r[0]).toEqual({ state: 'pending', transcript_status: 'pending', current_stage: 'extract' });
  });
});
```
Add sibling assertions: over-`autoLimit` adhoc → `needs_confirmation` + `{advance:false}`; over-`manualLimit` adhoc → `skipped_too_long` + `{advance:true}` (mock probe to return larger values per test).

- [ ] **Step 8: Run it — confirm it passes**

Run: `pnpm --filter @benkyou/core test extract-media runner-seam`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "feat(core): StageOutcome seam + extract media handoff + direct-media paste"
```

## Task B8: confirm endpoint

**Files:**
- Create: `packages/core/src/items/confirm-transcribe.ts`
- Modify: `packages/core/src/items/index.ts` (export)
- Create: `apps/web/app/api/items/[id]/confirm-transcribe/route.ts`
- Test: `packages/core/test/items/confirm-transcribe.int.test.ts`

**Interfaces:**
- Consumes: `transcribeBudgetSec`/`enqueueTranscribe` (B3), `getBoss`/`registerQueues`.
- Produces: `confirmTranscribe(itemId: string): Promise<{ enqueued: boolean }>` — guarded on `state='pending' AND transcript_status='needs_confirmation'`.

- [ ] **Step 1: Write the failing confirm test (double-submit no-op)**

```ts
// packages/core/test/items/confirm-transcribe.int.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('confirmTranscribe', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let confirmTranscribe: (id: string) => Promise<{ enqueued: boolean }>;
  let closeBoss: () => Promise<void>; let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('items/confirm-transcribe.int.test'); sql = db.sql;
    await sql`INSERT INTO user_settings (id,password_hash,embed_dim) VALUES (1,'x',1536)`;
    const q = await import('../../src/queue/index.js'); await q.registerQueues(await q.getBoss()); closeBoss = q.closeBoss;
    ({ confirmTranscribe } = await import('../../src/items/confirm-transcribe.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  async function seed(status = 'needs_confirmation'): Promise<string> {
    const r = await sql<{ id: string }[]>`
      INSERT INTO items (url,url_hash,title,content_type,media_url,video_duration,state,current_stage,transcript_status)
      VALUES ('https://cdn/a.mp3', gen_random_uuid()::text,'T','audio','https://cdn/a.mp3',3600,'pending','extract',${status})
      RETURNING id`;
    return r[0]!.id;
  }

  test('flips needs_confirmation → pending and enqueues once', async () => {
    const id = await seed();
    expect(await confirmTranscribe(id)).toEqual({ enqueued: true });
    const r = await sql<{ transcript_status: string }[]>`SELECT transcript_status FROM items WHERE id=${id}`;
    expect(r[0]!.transcript_status).toBe('pending');
  });

  test('double-submit is a no-op (guard on state=pending AND status=needs_confirmation)', async () => {
    const id = await seed();
    await confirmTranscribe(id);
    expect(await confirmTranscribe(id)).toEqual({ enqueued: false });
  });
});
```

- [ ] **Step 2: Run it — confirm it fails**

Run: `pnpm --filter @benkyou/core test confirm-transcribe`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `confirmTranscribe`**

```ts
// packages/core/src/items/confirm-transcribe.ts
import { and, eq, sql } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { getBoss, registerQueues, enqueueTranscribe } from '../queue';

export async function confirmTranscribe(itemId: string): Promise<{ enqueued: boolean }> {
  const db = getDbClient();
  // Atomic guard: only a parked item flips. A double-submit (or a submit on an item that
  // already advanced) updates zero rows → no-op.
  const flipped = await db.update(items)
    .set({ transcriptStatus: 'pending', updatedAt: sql`now()` })
    .where(and(eq(items.id, itemId), eq(items.state, 'pending'), eq(items.transcriptStatus, 'needs_confirmation')))
    .returning({ id: items.id, durationSec: items.videoDuration });
  const row = flipped[0];
  if (!row) return { enqueued: false };

  const boss = await getBoss();
  await registerQueues(boss);
  await enqueueTranscribe(boss, itemId, { durationSec: row.durationSec ?? 0 });
  return { enqueued: true };
}
```
Export from `items/index.ts`: `export { confirmTranscribe } from './confirm-transcribe';`.

- [ ] **Step 4: Add the API route**

```ts
// apps/web/app/api/items/[id]/confirm-transcribe/route.ts
import { confirmTranscribe } from '@benkyou/core/items';
import { requireApiAuth } from '@/lib/auth';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await params;
  const result = await confirmTranscribe(id);
  return Response.json(result);
}
```

- [ ] **Step 5: Run it — confirm it passes**

Run: `pnpm --filter @benkyou/core test confirm-transcribe`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/items apps/web/app/api/items/'[id]'/confirm-transcribe packages/core/test/items
git commit -m "feat: confirm-transcribe endpoint (guarded flip + enqueue)"
```

## Task B9: UI — status union, badge, audio block + confirm action, i18n

**Files:**
- Modify: `packages/core/src/sources/types.ts` (`TranscriptStatus += 'needs_confirmation'`)
- Modify: `apps/web/components/TranscriptBadge.tsx`
- Modify: `apps/web/app/(authed)/items/[id]/page.tsx`
- Create: `apps/web/components/ConfirmTranscribe.tsx`
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`
- Test: `apps/web/test/transcript-badge.test.ts` (source-string assertion — the repo's web-component test convention; vitest env is `node`, **no** `@testing-library`), `packages/core/test/items/pipeline-view.test.ts` (extend)

**Interfaces:**
- Consumes: `confirmTranscribe` endpoint (B8); `mapStep` (already passes `transcript_status` through).
- Produces: `TranscriptStatus` union incl. `needs_confirmation`; badge + audio block + confirm button rendering.

- [ ] **Step 1: Widen the union + add the pipeline-view assertion**

In `sources/types.ts`:
```ts
export type TranscriptStatus =
  | 'na' | 'pending' | 'present'
  | 'needs_confirmation'
  | 'skipped_too_long' | 'skipped_serverless' | 'unavailable';
```
Extend `packages/core/test/items/pipeline-view.test.ts`:
```ts
test('needs_confirmation surfaces as the extract sub-step (not folded away)', () => {
  const v = mapStep('pending', 'extract', 'needs_confirmation', null);
  expect(v).toEqual({ activeIndex: 1, failed: false, transcriptSub: 'needs_confirmation' });
});
test('pending transcript surfaces as transcribing sub-step', () => {
  const v = mapStep('pending', 'extract', 'pending', null);
  expect(v.transcriptSub).toBe('pending');
});
```
Run: `pnpm --filter @benkyou/core test pipeline-view` → PASS (no `mapStep` change needed — union widening only).

- [ ] **Step 2: Add the badge case (failing source-string test first)**

The web app's vitest env is `node` with no `@testing-library`; existing component tests (e.g. `extract-notice.test.ts`) assert on the component **source string**. Follow that convention:

```ts
// apps/web/test/transcript-badge.test.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import zh from '../messages/zh.json';
import en from '../messages/en.json';

const file = path.resolve(import.meta.dirname, '../components/TranscriptBadge.tsx');

describe('TranscriptBadge', () => {
  test('needs_confirmation is an explicit Known case, not folded to pending', async () => {
    const src = await readFile(file, 'utf8');
    // listed in the STATUS map (a distinct treatment) and admitted by the `known` narrowing
    expect(src).toMatch(/needs_confirmation:\s*'text-/);
    expect(src).toContain("status === 'needs_confirmation'");
  });
  test('needs_confirmation has a calm, non-pulsing dot (waits on the user, not working)', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toMatch(/needs_confirmation:\s*'bg-[^']*'/);
    expect(src).not.toMatch(/needs_confirmation:\s*'bg-[^']*animate-pulse/);
  });
  test('zh + en both carry the needs_confirmation label', () => {
    expect(zh.item.transcript.needs_confirmation).toBeTruthy();
    expect(en.item.transcript.needs_confirmation).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run it — confirm it fails**

Run: `pnpm --filter @benkyou/web test transcript-badge`
Expected: FAIL — `needs_confirmation` is not yet a case and the i18n keys are absent.

- [ ] **Step 4: Extend `TranscriptBadge`**

```tsx
const STATUS = {
  present: 'text-accent',
  pending: 'text-muted',
  needs_confirmation: 'text-muted', // calm "awaiting" — recessive, not the moss accent, not error red
  unavailable: 'text-faint',
} as const;

type Known = keyof typeof STATUS;
const DOT: Record<Known, string> = {
  present: 'bg-accent',
  pending: 'bg-muted animate-pulse motion-reduce:animate-none',
  needs_confirmation: 'bg-muted', // steady (no pulse): it is waiting on the user, not working
  unavailable: 'bg-faint',
};

export function TranscriptBadge({ status }: { status: string }) {
  const t = useTranslations('item');
  if (status === 'na' || status === '') return null;
  const known: Known =
    status === 'present' || status === 'unavailable' || status === 'needs_confirmation' ? status : 'pending';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs ${STATUS[known]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[known]}`} />
      {t(`transcript.${known}` as 'transcript.present')}
    </span>
  );
}
```

- [ ] **Step 5: Add i18n keys (zh + en)**

In `apps/web/messages/zh.json` under `item.transcript`:
```json
      "needs_confirmation": "待确认转写",
      "skipped_too_long": "超时长未转写",
      "skipped_serverless": "无服务端转写"
```
In `apps/web/messages/en.json` under `item.transcript`:
```json
      "needs_confirmation": "Awaiting confirmation",
      "skipped_too_long": "Too long — skipped",
      "skipped_serverless": "Transcription off (serverless)"
```
Add an `item.confirmTranscribe` action label: zh `"确认转写({minutes} 分钟)"`, en `"Transcribe (~{minutes} min)"`, and `item.confirming` zh `"提交中…"`, en `"Submitting…"`.

- [ ] **Step 6: Run check:i18n + the badge test**

Run: `pnpm check:i18n && pnpm --filter @benkyou/web test transcript-badge`
Expected: PASS (no missing zh/en keys; badge labels correctly).

- [ ] **Step 7: Audio block + confirm action in the detail page**

`getItemForUser` only returns `done` items; a `needs_confirmation`/`pending`/`transcribing` item is shown by the `getItemProgress` branch. Render the audio + confirm controls there (and the `<audio>` on the done page for `content_type='audio'`). Create `ConfirmTranscribe.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

// {/* DESIGN-GAP: audio block + confirm action — structurally-neutral shell; impeccable polishes the look later */}
export function ConfirmTranscribe({ itemId, estimatedMinutes }: { itemId: string; estimatedMinutes: number }) {
  const t = useTranslations('item');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    await fetch(`/api/items/${itemId}/confirm-transcribe`, { method: 'POST' });
    router.refresh(); // double-click is a no-op server-side (endpoint guard)
  }
  return (
    <button type="button" onClick={confirm} disabled={busy}
      className="rounded-full border border-line px-3 py-1 text-sm text-ink disabled:opacity-50">
      {busy ? t('confirming') : t('confirmTranscribe', { minutes: estimatedMinutes })}
    </button>
  );
}
```
In `page.tsx` progress branch, when `progress.transcriptStatus === 'needs_confirmation'` render `<ConfirmTranscribe itemId={progress.id} estimatedMinutes={Math.round((progress.durationSec ?? 0) / 60)} />`. Add `durationSec` (mapped from `items.videoDuration`) to `ItemProgress`/`getItemProgress`. For `content_type='audio'` done items, render `<audio controls src={item.mediaUrl ?? item.url} />` wrapped in a `{/* DESIGN-GAP */}` shell; add `mediaUrl` to `ItemDetail`/`FEED_COLUMNS` and the audio-vs-video badge condition (`item.contentType === 'video' || item.contentType === 'audio'`).

- [ ] **Step 8: Verify in the browser**

```bash
pnpm --filter @benkyou/web dev
```
Manually: paste a direct `.mp3` URL under auto-limit → item shows "转写中"; an over-auto-limit URL → "待确认转写" + confirm button; click → flips to "转写中"; double-click → no second job. Confirm the `<audio>` plays on a done audio item.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/sources/types.ts apps/web/components apps/web/app/'(authed)'/items packages/core/src/items/queries.ts apps/web/messages packages/core/test apps/web/test
git commit -m "feat(web): needs_confirmation badge, audio block, confirm action + i18n"
```

## Task B10: observability — orphan exclusion, queue health, cost lane

**Files:**
- Modify: `packages/core/src/pipeline/status.ts`
- Test: `packages/core/test/pipeline/transcribe-observability.int.test.ts`

**Interfaces:**
- Consumes: `TRANSCRIBE_QUEUE`/`TRANSCRIBE_DEAD_LETTER` constants.
- Produces: `getOrphans` excludes `needs_confirmation`; `getQueueHealth` lists transcribe queues; a transcription lane in `PipelineStatus`.

- [ ] **Step 1: Write the failing observability test**

```ts
// packages/core/test/pipeline/transcribe-observability.int.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

describe('transcribe observability', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let getOrphans: () => Promise<{ id: string }[]>;
  let getTranscriptionMinutes: () => Promise<number>;
  let closeBoss: () => Promise<void>; let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/transcribe-observability.int.test'); sql = db.sql;
    const q = await import('../../src/queue/index.js'); await q.registerQueues(await q.getBoss()); closeBoss = q.closeBoss;
    const s = await import('../../src/pipeline/status.js');
    getOrphans = s.getOrphans; getTranscriptionMinutes = s.getTranscriptionMinutes;
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  test('needs_confirmation items are NOT reported as orphans (they wait on the user)', async () => {
    await sql`INSERT INTO items (url,url_hash,title,content_type,state,current_stage,transcript_status)
      VALUES ('https://cdn/x.mp3', gen_random_uuid()::text,'T','audio','pending','extract','needs_confirmation')`;
    const orphans = await getOrphans();
    expect(orphans).toEqual([]);
  });

  test('transcription minutes sum from ai_usage.duration_seconds', async () => {
    await sql`INSERT INTO ai_usage (stage,kind,model,duration_seconds) VALUES ('transcribe','transcription','whisper-1',600)`;
    await sql`INSERT INTO ai_usage (stage,kind,model,duration_seconds) VALUES ('transcribe','transcription','whisper-1',300)`;
    expect(await getTranscriptionMinutes()).toBe(15); // (600+300)/60
  });
});
```

- [ ] **Step 2: Run it — confirm it fails**

Run: `pnpm --filter @benkyou/core test transcribe-observability`
Expected: FAIL.

- [ ] **Step 3: Exclude `needs_confirmation` from orphans**

In `status.ts` `getOrphans`, add to the `WHERE`:
```sql
      AND i.transcript_status <> 'needs_confirmation'
```
(parked items wait on the user; they are not stuck.)

- [ ] **Step 4: List transcribe queues in queue health**

In `getQueueHealth`, extend the `name = ANY(ARRAY[...])` list to include `'transcribe','transcribe-failed'`.

- [ ] **Step 5: Add the transcription lane**

```ts
export async function getTranscriptionMinutes(): Promise<number> {
  const db = getDbClient();
  const r = await db
    .select({ secs: sql<number>`coalesce(sum(${aiUsage.durationSeconds}),0)::int` })
    .from(aiUsage)
    .where(and(eq(aiUsage.kind, 'transcription'), gte(aiUsage.createdAt, sql`now() - interval '7 days'`)));
  return Math.round((r[0]?.secs ?? 0) / 60);
}
```
Add `transcriptionMinutes: number` to `PipelineStatus`, populate it in `getPipelineStatus`'s `Promise.all`, and render it in `apps/web/app/(authed)/admin/jobs/page.tsx` as a separate line ("转写时长(分钟) / Transcription minutes") with a new `jobs.transcriptionMinutes` i18n key (zh + en). Audio minutes only — no money (spec §5.3).

- [ ] **Step 6: Run it — confirm it passes**

Run: `pnpm --filter @benkyou/core test transcribe-observability && pnpm check:i18n`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pipeline/status.ts apps/web/app/'(authed)'/admin/jobs apps/web/messages packages/core/test
git commit -m "feat: transcribe observability — orphan exclusion, queue health, minutes lane"
```

## Task B11: full-suite verification + finish branch

**Files:** none new — verification only.

- [ ] **Step 1: Run every CI check**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm build
pnpm test
```
Expected: all green. `pnpm build` is the only check that exercises the Next client/server bundle boundary — it must pass.

- [ ] **Step 2: Grep guards**

```bash
grep -rn "recordUsage" packages/core/src apps/web/app | grep -v 'src/ai/'   # expect: empty
grep -rn "video_manual_limit\|videoManualLimit" packages/core/src/queue     # expect: no expireInSeconds = manualLimit
```

- [ ] **Step 3: Hand off to finishing-a-development-branch**

Use `superpowers:finishing-a-development-branch` to open the M2b PR (Phase B) once Phase A is already merged.

---

## Self-Review

**Spec coverage** (M2b design §1–§11 + decision log):
- §1 runner seam → B7 (StageOutcome + extract handoff). Handoff table (transcribe/confirm/skip) → B7 Step 6 + B2 policy.
- §2 transcribe queue + runner + terminal + per-job expiry + dual-dispatcher → B3 (queue/budget/wiring) + B4 (runner/terminal/advance).
- §3 transcribe-policy → B2.
- §4 inputs (direct-media paste, podcast enclosure, probe/download boundary) → B1 (RawItem/RSS/ingest) + B5 (probe/download guards) + B7 (paste detection).
- §5 engine (download→chunk→concurrent Whisper→merge→write→usage) → B6.
- §6 ai_usage consolidation → Phase A (A1–A3) + the `kind='transcription'` record in B6.
- §7/§7-bis needs_confirmation + confirm sub-flow + union widening → B7 (status set) + B8 (endpoint) + B9 (UI/union/badge).
- §8 panel/observability (user-step mapping, orphan exclusion, queue health, cost lane) → B9 (mapping via union) + B10.
- §9 migrations/schema/deps → A1 (ai_usage cols) + B1 (media_url) + B6 (p-limit/ffmpeg).
- §10 spec deltas (List B) → Task 0.
- §11 testing targets → each task's TDD step covers its listed branch (policy branches, budget monotonicity, runner seam parks, runtranscribe guard, terminal degrade + redelivery no-op, probe/download caps, confirm double-submit, audio render, badge/i18n, chunk merge dedup + fallback, ai_usage no-double-count, podcast RSS, queue health + serverless skip).
- Decisions #1–#7 → all reflected (narrow inputs B1; queue-not-stage B3/B4; retryLimit=2 + own dead-letter B3/B4; needs_confirmation B7/B8; per-job expiry B3; current_stage='extract' B7 + advancePendingToExtracted writing 'embed' B4).

**Type consistency:** `transcribeBudgetSec`, `enqueueTranscribe(boss, id, {durationSec})`, `TranscribeJob {itemId}`, `TranscribeView`, `advancePendingToExtracted` (bool), `StageOutcome {advance}`, `transcribePolicy` signature, `ContentType` incl. `'audio'`, `TranscriptStatus` incl. `'needs_confirmation'` — all defined once and referenced with the same names across tasks.

**Placeholder scan:** every code step carries real code; every test step carries a real assertion; commands have expected outcomes. The one judgement call left to the implementer is the pg-boss per-send `expireInSeconds` verification (B3 Step 3 caveat) and the optional `maxBytes` test param (B5 Step 4) — both flagged explicitly with the fallback.

**Known clarification of the spec:** §1 says the media handoff runs "after the adapter returns"; B7 instead has transcribe-eligible media items **skip** the article adapter (running `extractArticle` on a raw `.mp3`, or letting it overwrite `content_type` to `'article'`, is wrong). Podcasts keep their ingest-time show-notes `raw_content`; paste has none. This preserves the spec's intent (probe→policy→handoff) without the clobber. Flagged here so review sees it as deliberate.
