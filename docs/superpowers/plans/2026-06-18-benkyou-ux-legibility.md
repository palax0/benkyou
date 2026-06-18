# Benkyou UX Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Benkyou self-explanatory (legible) by rebuilding four surfaces — source management, pipeline progress, first-run onboarding, and configuration — on a single shared vocabulary, with zero schema migration and without crossing the "reading-first, UI-recedes" line.

**Architecture:** Pure presentation/IA change driven by a small set of *single-point* core primitives (a state→step mapper, a per-source pipeline aggregate, an AI-readiness derivation, a source-type catalog, ranking presets, an onboarding-state derivation). The 6-stage internal state machine, the `final_score` formula, and the DB schema are untouched. UI consumes the core primitives; no UI re-implements a mapping or formula.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), React 19, Tailwind v4 (semantic tokens only), next-intl 4, Drizzle 0.45+, PostgreSQL 16, Vitest 4 + Testcontainers 12.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec and CLAUDE.md.

- **Zero schema migration.** Do not run `drizzle-kit generate`. All fields used (`poll_interval`, `weight`, `adhoc_source_weight`, `weight_alpha`/`beta`/`gamma`, `interest_tags`, nullable `llm_*`/`embed_*` provider columns, `embed_dim` NOT NULL) already exist.
- **Do not change the state machine.** The 5-step user vocabulary is a *presentation mapping only*. Internal stays 6-stage `pending → extracted → embedded → scored → dedup_done → done` (+ `failed`). State does not change during retries (only `attempts++` / `last_error`).
- **`final_score` formula stays single-point in `packages/core`.** Ranking presets/advanced only write `user_settings.weight_alpha/beta/gamma`. No UI duplicates the formula.
- **`embed_dim` is read-only in the UI** (Hard Invariant; spec §5.3). Never writable.
- **Single-user.** No `user_id`, no per-user concepts. Onboarding completion is *derived from real state* + localStorage — no onboarding progress table/column.
- **Provider abstraction unchanged.** All LLM/embedding calls go through `packages/core/src/ai`. Connectivity tests reuse existing `testLLM` / `testEmbedding`.
- **Manual import (adhoc) is a pseudo-source.** Pasted items stay `source_id IS NULL`, sorted by `adhoc_source_weight`. No `type='manual'` source row.
- **No new source adapters this round.** `youtube`/`bilibili` (M2a) and `hn`/`reddit` (v2) appear as *disabled IA placeholders* only. Never add unpromised types (X / Newsletter / Podcast).
- **`mapStep` single-point.** The state→step mapping lives in exactly one file (`packages/core/src/items/pipeline-view.ts`), reused by single-item / single-source / (future) scopes. Signature pinned: `mapStep(state, currentStage, transcriptStatus, lastError)`.
- **TypeScript strict** incl. `noUncheckedIndexedAccess`. No `any` without `// @ts-expect-error` + reason. **Named exports only** (pages/layouts exempt per Next.js).
- **Tokens only in `apps/web/components` and all touched surfaces** (spec §8 / DESIGN.md §6 mechanical guard): no raw hex, no Tailwind arbitrary-value brackets (`p-[13px]`, `bg-[#abc]`), no inline `style=`. Semantic tokens: `text-ink` `text-muted` `text-faint` `text-accent` `text-err`, `bg-bg` `bg-surface` `bg-surface-2` `bg-accent-vivid` `bg-accent-soft`, `border-line`, `rounded-md` `rounded-full`, `font-serif`. Where the kit lacks a primitive, leave a structurally-neutral shell marked `{/* DESIGN-GAP: … */}` — never improvise a visual value.
- **i18n parity.** Every user-visible string goes through `useTranslations()` / `getTranslations()`. Add identical key paths to BOTH `apps/web/messages/zh.json` and `apps/web/messages/en.json`. `pnpm check:i18n` must pass (compares flattened key sets).
- **Calm status (DESIGN.md §5).** Failure = one `--err` dot + one `last_error` line + `[retry]`. No flashing, no red blocks, no popups. `unavailable` transcript is normal degradation — never red. In-progress uses `--muted` + `animate-pulse` (with `motion-reduce:animate-none`).
- **Decisions locked at planning time:** (1) Build a minimal **Cmd+K command palette** (search + paste + nav) replacing the current search-only shortcut. (2) Keep **`/setup`** as a slimmed password-only bootstrap landing.

---

## Implementation Notes (read before starting)

**No `/api/items/[id]/status` route is built.** The spec (§3.3/§7) assumes a JSON status endpoint, but the *implemented* progress mechanism is RSC re-render: `apps/web/app/(authed)/items/[id]/page.tsx` is a server component that calls `getItemProgress(id)` (already returns `currentStage` / `transcriptStatus` / `lastError`), refreshed client-side by `<AutoRefresh>` (`router.refresh()` every 5s). The spec's "status payload needs `current_stage`" revision is therefore *already satisfied* — the server component has `current_stage`. The single-item stepper renders server-side from `getItemProgress` + `mapStep`. **Flag this to the user as a faithful divergence from spec §7.3 when back-annotating the main spec.**

**`mapStep` is the spine.** Tasks 1, 6, 7 all depend on it. Build it first.

**Source-type blocks render from the catalog (Task 4), never hardcoded.** Adding a platform later = one catalog entry + one adapter, page structure unchanged (spec §2.2 P3).

**Per-source status detail is loaded eagerly (not lazily) in this functional pass.** Spec §3.4 / open-question §11.3 want lazy-load-on-expand as an optimization; we fetch the (small) in-flight + failed lists server-side and hide them in a collapsed `<details>`. Lazy-load is explicitly deferred — note it with a code comment, do not build a new endpoint for it.

---

## File Structure

**New core files:**
- `packages/core/src/items/pipeline-view.ts` — `mapStep` + `PIPELINE_STEPS` (the 5-step vocabulary; single source of truth).
- `packages/core/src/sources/catalog.ts` — `SOURCE_TYPE_CATALOG` (registry-driven IA backbone).
- `packages/core/src/settings/ranking-presets.ts` — preset ↔ α/β/γ mapping.
- `packages/core/src/onboarding.ts` — `getOnboardingState()` (real-state-derived completion).

**Modified core files:**
- `packages/core/src/items/queries.ts` — add `getSourcePipelineStatus`.
- `packages/core/src/settings/index.ts` — add `aiReadiness` / `isAiConfigured`; extend `SettingsPatch` with `adhocSourceWeight` / `weightAlpha` / `weightBeta` / `weightGamma`.
- `packages/core/src/setup/index.ts` — `SetupInput`/`completeSetup` slimmed to password-only bootstrap.
- `packages/core/src/sources/manage.ts` — `createSource`/`updateSource` accept `pollInterval` + `enabled`.
- `packages/core/src/items/index.ts`, `packages/core/src/sources/index.ts`, `packages/core/src/settings/index.ts` — re-export new symbols.

**New web files:**
- `apps/web/components/PipelineStepper.tsx` — dumb 5-step stepper view.
- `apps/web/components/PasteModal.tsx` — global paste dialog (client).
- `apps/web/components/CommandPalette.tsx` — Cmd+K palette (client).
- `apps/web/app/(authed)/sources/SourceTypeBlock.tsx` — one source-type section (implemented or planned).
- `apps/web/app/(authed)/sources/SourcePipelineStatus.tsx` — per-source compact status + expand.
- `apps/web/app/(authed)/sources/AdhocCard.tsx` — manual-import pseudo-source card.
- `apps/web/app/(authed)/sources/SourcesOverviewBar.tsx` — overview counts.
- `apps/web/app/(authed)/settings/sections/` — `AiServicesSection.tsx`, `RankingSection.tsx`, `InterestsSection.tsx`, `AppearanceSection.tsx` (AccountSection reuses `PasswordForm`).
- `apps/web/components/OnboardingChecklist.tsx` — 3-step in-app guide (client; localStorage dismiss).

**Modified web files:** `sources/page.tsx`, `sources/actions.ts`, `sources/AddSourceForm.tsx`, `sources/EditSourceForm.tsx`, `sources/DeleteSourceForm.tsx`, `sources/SourceList.tsx` (folded into `SourceTypeBlock`), `settings/page.tsx`, `settings/SettingsForm.tsx` (split), `settings/actions.ts`, `setup/SetupForm.tsx`, `setup/actions.ts`, `login/LoginForm.tsx`, `items/[id]/page.tsx`, `(authed)/page.tsx` (remove inline paste), `components/shell/AppShell.tsx` (top-bar paste button + mount palette/modal), `components/shell/useShellState.ts` (replace `useGlobalSearchShortcut`), `api/items/paste/route.ts` (readiness gate), `search/page.tsx` (readiness gate).

---

# Phase A — Core primitives (logic, TDD)

### Task 1: `mapStep` — the single-point pipeline vocabulary

**Files:**
- Create: `packages/core/src/items/pipeline-view.ts`
- Modify: `packages/core/src/items/index.ts`
- Test: `packages/core/test/items/pipeline-view.test.ts`

**Interfaces:**
- Consumes: `ItemState` / `PerItemStage` from `../pipeline/state`; `TranscriptStatus` from `../sources/types`.
- Produces: `PIPELINE_STEPS` (readonly tuple of 5), `PipelineStep`, `StepView { activeIndex: number; failed: boolean; transcriptSub: TranscriptStatus | null }`, `mapStep(state: string, currentStage: string | null, transcriptStatus: string, lastError: string | null): StepView`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/items/pipeline-view.test.ts
import { describe, expect, test } from 'vitest';
import { mapStep, PIPELINE_STEPS } from '../../src/items/pipeline-view';

describe('mapStep', () => {
  test('5-step vocabulary in order', () => {
    expect(PIPELINE_STEPS).toEqual(['fetch', 'extract', 'embed', 'score', 'done']);
  });

  test('just created (pending, no stage) → extract is the active step', () => {
    expect(mapStep('pending', null, 'na', null)).toEqual({ activeIndex: 1, failed: false, transcriptSub: null });
  });

  test('maps each internal stage to its user step', () => {
    expect(mapStep('pending', 'extract', 'na', null).activeIndex).toBe(1);
    expect(mapStep('extracted', 'embed', 'na', null).activeIndex).toBe(2);
    expect(mapStep('embedded', 'score', 'na', null).activeIndex).toBe(3);
    expect(mapStep('scored', 'dedup', 'na', null).activeIndex).toBe(4);
    expect(mapStep('dedup_done', 'summary', 'na', null).activeIndex).toBe(4);
  });

  test('done → all five complete (activeIndex 5)', () => {
    expect(mapStep('done', null, 'na', null)).toEqual({ activeIndex: 5, failed: false, transcriptSub: null });
  });

  test('failed → failed flag + step located by current_stage', () => {
    expect(mapStep('failed', 'extract', 'na', 'HTTP 403')).toEqual({ activeIndex: 1, failed: true, transcriptSub: null });
    expect(mapStep('failed', 'score', 'na', 'boom').failed).toBe(true);
  });

  test('video transcribing shows a transcript sub-status on the extract step', () => {
    expect(mapStep('pending', 'extract', 'pending', null).transcriptSub).toBe('pending');
    expect(mapStep('pending', 'extract', 'na', null).transcriptSub).toBeNull();
    // sub-status only on the extract step, not later steps
    expect(mapStep('embedded', 'score', 'pending', null).transcriptSub).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/items/pipeline-view.test.ts`
Expected: FAIL — cannot find module `pipeline-view`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/items/pipeline-view.ts
import type { PerItemStage } from '../pipeline/state';
import type { TranscriptStatus } from '../sources/types';

// The ONE user-facing pipeline vocabulary (spec §3.1). Reused at single-item,
// single-source, and any future scope — never re-defined in a UI layer.
export const PIPELINE_STEPS = ['fetch', 'extract', 'embed', 'score', 'done'] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export interface StepView {
  // 0-based index into PIPELINE_STEPS of the in-progress step; 5 when fully done.
  activeIndex: number;
  failed: boolean;
  // Non-null only while the active step is 'extract' for a video (transcript_status != 'na').
  transcriptSub: TranscriptStatus | null;
}

// dedup + summary are internal-only environments (spec §3.1): both surface as the
// fifth step ("完成") still in progress, never as their own user-facing steps.
const STAGE_STEP_INDEX: Record<PerItemStage, number> = {
  extract: 1,
  embed: 2,
  score: 3,
  dedup: 4,
  summary: 4,
};

function isPerItemStage(s: string | null): s is PerItemStage {
  return s != null && s in STAGE_STEP_INDEX;
}

export function mapStep(
  state: string,
  currentStage: string | null,
  transcriptStatus: string,
  // Part of the pinned signature (spec §3.1); the UI renders last_error separately.
  _lastError: string | null,
): StepView {
  // current_stage is the primary axis: state='pending' alone can't tell
  // "just created" from "extracting"/"transcribing". A null/unknown stage on a
  // not-yet-advanced item means extract is the next/active step.
  const activeIndex = isPerItemStage(currentStage) ? STAGE_STEP_INDEX[currentStage] : 1;
  const transcriptSub =
    activeIndex === 1 && transcriptStatus !== 'na' ? (transcriptStatus as TranscriptStatus) : null;

  if (state === 'done') return { activeIndex: 5, failed: false, transcriptSub: null };
  if (state === 'failed') return { activeIndex, failed: true, transcriptSub };
  return { activeIndex, failed: false, transcriptSub };
}
```

- [ ] **Step 4: Re-export from the items barrel**

In `packages/core/src/items/index.ts` add:

```ts
export { mapStep, PIPELINE_STEPS } from './pipeline-view';
export type { PipelineStep, StepView } from './pipeline-view';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/items/pipeline-view.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/items/pipeline-view.ts packages/core/src/items/index.ts packages/core/test/items/pipeline-view.test.ts
git commit -m "feat(core): single-point user-facing pipeline step mapping"
```

---

### Task 2: `getSourcePipelineStatus` — per-source pipeline aggregate

**Files:**
- Modify: `packages/core/src/items/queries.ts`
- Modify: `packages/core/src/items/index.ts`
- Test: `packages/core/test/items/source-pipeline-status.int.test.ts`

**Interfaces:**
- Consumes: `mapStep` (Task 1); `items` table.
- Produces: `SourcePipelineStatus { inFlight: { itemId: string; title: string; step: number }[]; doneCount: number; failed: { itemId: string; title: string; error: string | null }[] }`; `getSourcePipelineStatus(sourceId: string): Promise<SourcePipelineStatus>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/items/source-pipeline-status.int.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

type ItemsModule = typeof import('../../src/items/index.js');
const SOURCE = '55555555-5555-5555-5555-555555555555';

describe('getSourcePipelineStatus', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let items: ItemsModule;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('items/source-pipeline-status.int.test');
    sql = db.sql;
    await sql`INSERT INTO sources (id, type, name, config) VALUES
      (${SOURCE}, 'rss', 'Feed', '{"url":"https://x.example.com"}')`;
    await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state, current_stage, last_error) VALUES
      (${SOURCE}, 'https://x/1', 'h1', 'Done A',    'article', 'done',      null,     null),
      (${SOURCE}, 'https://x/2', 'h2', 'Done B',    'article', 'done',      null,     null),
      (${SOURCE}, 'https://x/3', 'h3', 'Embedding', 'article', 'extracted', 'embed',  null),
      (${SOURCE}, 'https://x/4', 'h4', 'Scoring',   'article', 'embedded',  'score',  null),
      (${SOURCE}, 'https://x/5', 'h5', 'Broken',    'article', 'failed',    'extract','HTTP 403')`;
    items = await import('../../src/items/index.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('buckets items into done count, in-flight (with step), and failed (with error)', async () => {
    const s = await items.getSourcePipelineStatus(SOURCE);
    expect(s.doneCount).toBe(2);
    expect(s.inFlight).toHaveLength(2);
    expect(s.inFlight.map((i) => i.step).sort()).toEqual([2, 3]);
    expect(s.failed).toHaveLength(1);
    expect(s.failed[0]?.title).toBe('Broken');
    expect(s.failed[0]?.error).toBe('HTTP 403');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/items/source-pipeline-status.int.test.ts`
Expected: FAIL — `getSourcePipelineStatus` is not a function.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/items/queries.ts`, add `ne` to the drizzle import (`import { and, desc, eq, ne, sql } from 'drizzle-orm';`), import `mapStep` at top (`import { mapStep } from './pipeline-view';`), and append:

```ts
export interface SourcePipelineStatus {
  inFlight: { itemId: string; title: string; step: number }[];
  doneCount: number;
  failed: { itemId: string; title: string; error: string | null }[];
}

// Per-source pipeline summary (spec §3.4). doneCount is a COUNT (a source may have
// thousands of done items); only the small non-terminal + failed rows are
// materialised. NOTE: detail is fetched eagerly here — lazy-load-on-expand
// (spec §11.3) is a deferred optimization, not built this round.
export async function getSourcePipelineStatus(sourceId: string): Promise<SourcePipelineStatus> {
  const db = getDbClient();
  const doneRows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(items)
    .where(and(eq(items.sourceId, sourceId), eq(items.state, 'done')));
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      state: items.state,
      currentStage: items.currentStage,
      transcriptStatus: items.transcriptStatus,
      lastError: items.lastError,
    })
    .from(items)
    .where(and(eq(items.sourceId, sourceId), ne(items.state, 'done')));

  const status: SourcePipelineStatus = { inFlight: [], doneCount: doneRows[0]?.c ?? 0, failed: [] };
  for (const r of rows) {
    if (r.state === 'failed') {
      status.failed.push({ itemId: r.id, title: r.title, error: r.lastError });
      continue;
    }
    const step = mapStep(r.state, r.currentStage, r.transcriptStatus, r.lastError).activeIndex;
    status.inFlight.push({ itemId: r.id, title: r.title, step });
  }
  return status;
}
```

- [ ] **Step 4: Re-export**

In `packages/core/src/items/index.ts`:

```ts
export { getSourcePipelineStatus } from './queries';
export type { SourcePipelineStatus } from './queries';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/items/source-pipeline-status.int.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/items/queries.ts packages/core/src/items/index.ts packages/core/test/items/source-pipeline-status.int.test.ts
git commit -m "feat(core): per-source pipeline status aggregate"
```

---

### Task 3: AI readiness derivation

**Files:**
- Modify: `packages/core/src/settings/index.ts`
- Test: `packages/core/test/settings/readiness.test.ts`

**Interfaces:**
- Consumes: `UserSettings` (the inferred select type).
- Produces: `AiReadiness = 'bootstrapped' | 'aiConfigured'`; `aiReadiness(s): AiReadiness`; `isAiConfigured(s): boolean`. Both accept `Pick<UserSettings, 'llmProvider' | 'llmModel' | 'embedProvider' | 'embedModel'>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/settings/readiness.test.ts
import { describe, expect, test } from 'vitest';
import { aiReadiness, isAiConfigured } from '../../src/settings/index';

const base = { llmProvider: null, llmModel: null, embedProvider: null, embedModel: null };

describe('aiReadiness', () => {
  test('all provider+model present → aiConfigured', () => {
    const s = { llmProvider: 'openai', llmModel: 'gpt', embedProvider: 'openai', embedModel: 'emb' };
    expect(aiReadiness(s)).toBe('aiConfigured');
    expect(isAiConfigured(s)).toBe(true);
  });

  test('any provider/model missing → bootstrapped', () => {
    expect(aiReadiness(base)).toBe('bootstrapped');
    expect(aiReadiness({ ...base, llmProvider: 'openai', llmModel: 'gpt' })).toBe('bootstrapped');
    expect(isAiConfigured({ ...base, embedProvider: 'openai', embedModel: 'emb' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/settings/readiness.test.ts`
Expected: FAIL — `aiReadiness` not exported.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/settings/index.ts` append:

```ts
// Two derived AI-readiness states (spec §4.4), computed from existing user_settings
// columns — no new column. bootstrapped = row exists (password set) but provider
// unconfigured; aiConfigured = llm + embed provider+model all present.
export type AiReadiness = 'bootstrapped' | 'aiConfigured';

type ProviderFields = Pick<UserSettings, 'llmProvider' | 'llmModel' | 'embedProvider' | 'embedModel'>;

export function isAiConfigured(s: ProviderFields): boolean {
  return Boolean(s.llmProvider && s.llmModel && s.embedProvider && s.embedModel);
}

export function aiReadiness(s: ProviderFields): AiReadiness {
  return isAiConfigured(s) ? 'aiConfigured' : 'bootstrapped';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/settings/readiness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/settings/index.ts packages/core/test/settings/readiness.test.ts
git commit -m "feat(core): derive AI readiness (bootstrapped vs aiConfigured)"
```

---

### Task 4: Source-type catalog (registry-driven IA backbone)

**Files:**
- Create: `packages/core/src/sources/catalog.ts`
- Modify: `packages/core/src/sources/index.ts`
- Test: `packages/core/test/sources/catalog.test.ts`

**Interfaces:**
- Produces: `SourceTypeStatus = 'implemented' | 'planned'`; `SourceTypeInfo { type: string; status: SourceTypeStatus; milestone?: string }`; `SOURCE_TYPE_CATALOG: readonly SourceTypeInfo[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/sources/catalog.test.ts
import { describe, expect, test } from 'vitest';
import { SOURCE_TYPE_CATALOG } from '../../src/sources/catalog';

describe('SOURCE_TYPE_CATALOG', () => {
  const byType = Object.fromEntries(SOURCE_TYPE_CATALOG.map((t) => [t.type, t]));

  test('rss is the only implemented type this round', () => {
    expect(byType.rss?.status).toBe('implemented');
    expect(SOURCE_TYPE_CATALOG.filter((t) => t.status === 'implemented').map((t) => t.type)).toEqual(['rss']);
  });

  test('youtube/bilibili are planned for M2a; hn/reddit for v2', () => {
    expect(byType.youtube).toMatchObject({ status: 'planned', milestone: 'M2a' });
    expect(byType.bilibili).toMatchObject({ status: 'planned', milestone: 'M2a' });
    expect(byType.hn).toMatchObject({ status: 'planned', milestone: 'v2' });
    expect(byType.reddit).toMatchObject({ status: 'planned', milestone: 'v2' });
  });

  test('adhoc-only "article" type is not an IA block', () => {
    expect(byType.article).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/sources/catalog.test.ts`
Expected: FAIL — cannot find module `catalog`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/sources/catalog.ts
// Drives the /sources page IA (spec §2.2): one block per entry, rendered from this
// catalog — never hardcoded. 'article' is intentionally absent: it is adhoc-only
// (paste), surfaced as the separate manual-import card, not a source-type block.
export type SourceTypeStatus = 'implemented' | 'planned';

export interface SourceTypeInfo {
  type: string;
  status: SourceTypeStatus;
  milestone?: string; // planned types only
}

export const SOURCE_TYPE_CATALOG: readonly SourceTypeInfo[] = [
  { type: 'rss', status: 'implemented' },
  { type: 'youtube', status: 'planned', milestone: 'M2a' },
  { type: 'bilibili', status: 'planned', milestone: 'M2a' },
  { type: 'hn', status: 'planned', milestone: 'v2' },
  { type: 'reddit', status: 'planned', milestone: 'v2' },
];
```

- [ ] **Step 4: Re-export**

In `packages/core/src/sources/index.ts` add:

```ts
export { SOURCE_TYPE_CATALOG } from './catalog';
export type { SourceTypeInfo, SourceTypeStatus } from './catalog';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/sources/catalog.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sources/catalog.ts packages/core/src/sources/index.ts packages/core/test/sources/catalog.test.ts
git commit -m "feat(core): source-type catalog driving /sources IA"
```

---

### Task 5: Ranking presets (preset ↔ α/β/γ)

**Files:**
- Create: `packages/core/src/settings/ranking-presets.ts`
- Modify: `packages/core/src/settings/index.ts`
- Test: `packages/core/test/settings/ranking-presets.test.ts`

**Interfaces:**
- Produces: `RankingPreset = 'balanced' | 'relevance' | 'depth' | 'source'`; `Weights { alpha: number; beta: number; gamma: number }`; `RANKING_PRESETS: Record<RankingPreset, Weights>`; `matchPreset(w: Weights): RankingPreset | 'custom'`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/settings/ranking-presets.test.ts
import { describe, expect, test } from 'vitest';
import { RANKING_PRESETS, matchPreset } from '../../src/settings/ranking-presets';

describe('ranking presets', () => {
  test('preset values match spec §5.3 table', () => {
    expect(RANKING_PRESETS.balanced).toEqual({ alpha: 0.6, beta: 0.3, gamma: 0.1 });
    expect(RANKING_PRESETS.relevance).toEqual({ alpha: 0.75, beta: 0.15, gamma: 0.1 });
    expect(RANKING_PRESETS.depth).toEqual({ alpha: 0.4, beta: 0.5, gamma: 0.1 });
    expect(RANKING_PRESETS.source).toEqual({ alpha: 0.5, beta: 0.2, gamma: 0.3 });
  });

  test('matchPreset round-trips a known preset', () => {
    expect(matchPreset({ alpha: 0.6, beta: 0.3, gamma: 0.1 })).toBe('balanced');
    expect(matchPreset({ alpha: 0.4, beta: 0.5, gamma: 0.1 })).toBe('depth');
  });

  test('off-preset weights → custom', () => {
    expect(matchPreset({ alpha: 0.5, beta: 0.5, gamma: 0.0 })).toBe('custom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/settings/ranking-presets.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/settings/ranking-presets.ts
// Presets are UI sugar over user_settings.weight_alpha/beta/gamma (spec §5.3).
// The final_score formula stays single-point in packages/core; this only chooses
// which α/β/γ to write. Sums ≈ 1; revisit after M3 smart ranking ships.
export type RankingPreset = 'balanced' | 'relevance' | 'depth' | 'source';

export interface Weights {
  alpha: number;
  beta: number;
  gamma: number;
}

export const RANKING_PRESETS: Record<RankingPreset, Weights> = {
  balanced: { alpha: 0.6, beta: 0.3, gamma: 0.1 },
  relevance: { alpha: 0.75, beta: 0.15, gamma: 0.1 },
  depth: { alpha: 0.4, beta: 0.5, gamma: 0.1 },
  source: { alpha: 0.5, beta: 0.2, gamma: 0.3 },
};

const EPS = 1e-6;
const close = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

export function matchPreset(w: Weights): RankingPreset | 'custom' {
  for (const name of Object.keys(RANKING_PRESETS) as RankingPreset[]) {
    const p = RANKING_PRESETS[name];
    if (close(p.alpha, w.alpha) && close(p.beta, w.beta) && close(p.gamma, w.gamma)) return name;
  }
  return 'custom';
}
```

- [ ] **Step 4: Re-export**

In `packages/core/src/settings/index.ts`:

```ts
export { RANKING_PRESETS, matchPreset } from './ranking-presets';
export type { RankingPreset, Weights } from './ranking-presets';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/settings/ranking-presets.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/settings/ranking-presets.ts packages/core/src/settings/index.ts packages/core/test/settings/ranking-presets.test.ts
git commit -m "feat(core): ranking-style presets over weight_alpha/beta/gamma"
```

---

### Task 6: Slim `completeSetup` to password-only bootstrap; extend `SettingsPatch`; extend `createSource`/`updateSource`

This task carries three small, related core changes that the onboarding refactor depends on. They share a review surface (the "bootstrap split + draft sources + new patch fields" decision) and are tested together.

**Files:**
- Modify: `packages/core/src/setup/index.ts`
- Modify: `packages/core/src/settings/index.ts`
- Modify: `packages/core/src/sources/manage.ts`
- Test: `packages/core/test/setup/bootstrap.int.test.ts`
- Test (update): `packages/core/test/setup/setup.int.test.ts`

**Interfaces:**
- Produces: `SetupInput { password: string; locale: 'zh' | 'en' }`; `completeSetup(input: SetupInput): Promise<{ inserted: boolean }>` (provider columns left NULL, `embed_dim` from `env.EMBED_DIM`, `interest_tags` = `[]`).
- Produces (manage): `createSource(input: { name: string; url: string; weight: number; pollInterval?: number; enabled?: boolean }): Promise<string>`; `updateSource(id: string, input: { name: string; url: string; weight: number; pollInterval?: number }): Promise<void>`.
- Produces (settings): `SettingsPatch` gains `adhocSourceWeight?: string`, `weightAlpha?: string`, `weightBeta?: string`, `weightGamma?: string`.

- [ ] **Step 1: Write the failing test (bootstrap)**

```ts
// packages/core/test/setup/bootstrap.int.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';

type SetupModule = typeof import('../../src/setup/index.js');
type SettingsModule = typeof import('../../src/settings/index.js');

describe('completeSetup (password-only bootstrap)', () => {
  let db: TestDatabase;
  let setup: SetupModule;
  let settings: SettingsModule;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('setup/bootstrap.int.test');
    setup = await import('../../src/setup/index.js');
    settings = await import('../../src/settings/index.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('creates the row with password + locale, provider columns NULL → bootstrapped', async () => {
    const res = await setup.completeSetup({ password: 'hunter2hunter2', locale: 'zh' });
    expect(res.inserted).toBe(true);
    const s = await settings.getUserSettings();
    expect(s?.llmProvider).toBeNull();
    expect(s?.embedProvider).toBeNull();
    expect(s?.embedDim).toBeGreaterThan(0); // from env.EMBED_DIM
    expect(settings.aiReadiness(s!)).toBe('bootstrapped');
  });

  test('second call is a no-op (single row id=1)', async () => {
    const res = await setup.completeSetup({ password: 'other', locale: 'en' });
    expect(res.inserted).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/setup/bootstrap.int.test.ts`
Expected: FAIL — `completeSetup` still requires `llm`/`embedding`/`interestTags`.

- [ ] **Step 3: Rewrite `SetupInput` / `completeSetup`**

In `packages/core/src/setup/index.ts`, replace the `SetupInput` interface and `completeSetup` body with:

```ts
export interface SetupInput {
  password: string;
  locale: 'zh' | 'en';
}

// Bootstrap split (spec §4.2): create the single user_settings row with password +
// locale + frozen embed_dim ONLY. Provider columns stay NULL (nullable in schema);
// they are filled later in-app via the settings flow (onboarding step ①).
export async function completeSetup(input: SetupInput): Promise<{ inserted: boolean }> {
  const db = getDbClient();
  const passwordHash = await hashPassword(input.password);
  const rows = await db
    .insert(userSettings)
    .values({
      id: 1,
      passwordHash,
      locale: input.locale,
      embedDim: env.EMBED_DIM, // frozen at install time (Hard Invariant)
      interestTags: [],
    })
    .onConflictDoNothing({ target: userSettings.id })
    .returning({ id: userSettings.id });
  return { inserted: rows.length > 0 };
}
```

Remove the now-unused imports in `setup/index.ts` that only served the old provider insert (`embed`, `generateText`, `resolveEmbedding`, `resolveLLM`, `embeddingProviderOptions`, `EmbeddingConfig`, `LLMConfig`) **only if** `testLLM`/`testEmbedding` below still need them — they do (`generateText`, `resolveLLM`, `embed`, `resolveEmbedding`, `embeddingProviderOptions`, `EmbeddingConfig`, `LLMConfig` are used by `testLLM`/`testEmbedding`). Keep all those; only the `userSettings` insert shrank. Verify with typecheck in Step 7.

- [ ] **Step 4: Extend `createSource` / `updateSource`**

In `packages/core/src/sources/manage.ts` replace `createSource` and `updateSource` with:

```ts
export async function createSource(input: {
  name: string;
  url: string;
  weight: number;
  pollInterval?: number;
  enabled?: boolean;
}): Promise<string> {
  const db = getDbClient();
  const rows = await db
    .insert(sources)
    .values({
      type: 'rss',
      name: input.name,
      config: { url: input.url },
      weight: String(input.weight),
      // enabled=false stores a "draft" source the poll loop skips (spec §4.4):
      // lets a not-yet-aiConfigured user add a source without it failing.
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.pollInterval === undefined ? {} : { pollInterval: input.pollInterval }),
    })
    .returning({ id: sources.id });
  const id = rows[0]?.id;
  if (!id) throw new Error('Failed to create source');
  return id;
}

export async function updateSource(
  id: string,
  input: { name: string; url: string; weight: number; pollInterval?: number },
): Promise<void> {
  const db = getDbClient();
  await db
    .update(sources)
    .set({
      name: input.name,
      config: { url: input.url },
      weight: String(input.weight),
      ...(input.pollInterval === undefined ? {} : { pollInterval: input.pollInterval }),
    })
    .where(eq(sources.id, id));
}
```

- [ ] **Step 5: Extend `SettingsPatch`**

In `packages/core/src/settings/index.ts`, add to the `SettingsPatch` interface:

```ts
  adhocSourceWeight?: string;
  weightAlpha?: string;
  weightBeta?: string;
  weightGamma?: string;
```

(`updateSettings` already spreads `...patch`; these numeric columns accept string values, matching `weight: String(...)` elsewhere.)

- [ ] **Step 6: Update the existing setup int test**

`packages/core/test/setup/setup.int.test.ts` likely calls `completeSetup` with the old shape and/or asserts provider columns. Update it: call `completeSetup({ password, locale })`, drop provider/source assertions, and assert `aiReadiness` is `'bootstrapped'`. Read the file first; adjust only the call sites and assertions that referenced the removed fields. If it also tested `addRssSource`, keep that part (the function still exists).

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @benkyou/core exec vitest run test/setup/bootstrap.int.test.ts test/setup/setup.int.test.ts && pnpm --filter @benkyou/core typecheck`
Expected: PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/setup/index.ts packages/core/src/sources/manage.ts packages/core/src/settings/index.ts packages/core/test/setup/
git commit -m "feat(core): password-only bootstrap, draft sources, ranking/adhoc patch fields"
```

---

### Task 7: `getOnboardingState` — real-state-derived onboarding completion

**Files:**
- Create: `packages/core/src/onboarding.ts`
- Modify: `packages/core/src/index.ts` (barrel, if one exists; otherwise import via subpath)
- Test: `packages/core/test/onboarding.int.test.ts`

**Interfaces:**
- Consumes: `getUserSettings` + `isAiConfigured` (settings), `items`, `sources` tables.
- Produces: `OnboardingState { aiConfigured: boolean; hasSource: boolean; hasItem: boolean; hasDone: boolean }`; `getOnboardingState(): Promise<OnboardingState>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/onboarding.int.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from './db-harness/helpers';
import postgres from 'postgres';

type OnboardingModule = typeof import('../src/onboarding.js');
type SetupModule = typeof import('../src/setup/index.js');
const SOURCE = '66666666-6666-6666-6666-666666666666';

describe('getOnboardingState', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let onboarding: OnboardingModule;
  let setup: SetupModule;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('onboarding.int.test');
    sql = db.sql;
    setup = await import('../src/setup/index.js');
    onboarding = await import('../src/onboarding.js');
    ({ closeDbClient } = await import('../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('fresh bootstrap → all false', async () => {
    await setup.completeSetup({ password: 'hunter2hunter2', locale: 'zh' });
    expect(await onboarding.getOnboardingState()).toEqual({
      aiConfigured: false, hasSource: false, hasItem: false, hasDone: false,
    });
  });

  test('reflects source + item + done presence', async () => {
    await sql`INSERT INTO sources (id, type, name, config) VALUES
      (${SOURCE}, 'rss', 'Feed', '{"url":"https://x.example.com"}')`;
    await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state) VALUES
      (${SOURCE}, 'https://x/1', 'h1', 'Pending', 'article', 'pending'),
      (${SOURCE}, 'https://x/2', 'h2', 'Done',    'article', 'done')`;
    const s = await onboarding.getOnboardingState();
    expect(s.hasSource).toBe(true);
    expect(s.hasItem).toBe(true);
    expect(s.hasDone).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/onboarding.int.test.ts`
Expected: FAIL — cannot find module `onboarding`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/onboarding.ts
import { eq, sql } from 'drizzle-orm';
import { getDbClient, items, sources } from './db';
import { getUserSettings, isAiConfigured } from './settings';

// Onboarding completion is derived from real state (spec §4.3): provider config,
// source count, item count, first-done. No onboarding table/column. "Dismissed"
// is a client-only localStorage flag — not persisted here.
export interface OnboardingState {
  aiConfigured: boolean;
  hasSource: boolean;
  hasItem: boolean;
  hasDone: boolean;
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const db = getDbClient();
  const settings = await getUserSettings();
  const srcRows = await db.select({ c: sql<number>`count(*)::int` }).from(sources);
  const itemRows = await db.select({ c: sql<number>`count(*)::int` }).from(items);
  const doneRows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(items)
    .where(eq(items.state, 'done'));
  return {
    aiConfigured: settings ? isAiConfigured(settings) : false,
    hasSource: (srcRows[0]?.c ?? 0) > 0,
    hasItem: (itemRows[0]?.c ?? 0) > 0,
    hasDone: (doneRows[0]?.c ?? 0) > 0,
  };
}
```

- [ ] **Step 4: Ensure it is importable from `@benkyou/core`**

Check how `apps/web` imports core subpaths (e.g. `@benkyou/core/settings`). Mirror the existing `exports` map: confirm `@benkyou/core/onboarding` resolves (look at `packages/core/package.json` `exports`). If subpaths are explicitly enumerated there, add an `"./onboarding"` entry pointing at the built file, matching the pattern of `"./settings"`. If the map uses a wildcard, no change needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/onboarding.int.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/onboarding.ts packages/core/test/onboarding.int.test.ts packages/core/package.json
git commit -m "feat(core): derive onboarding completion from real state"
```

---

# Phase B — Pipeline readability UI

### Task 8: `PipelineStepper` component + single-item processing view

**Files:**
- Create: `apps/web/components/PipelineStepper.tsx`
- Modify: `apps/web/app/(authed)/items/[id]/page.tsx`
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`

🔧 Derivative (reuses tokens; the stepper dots follow DESIGN.md §5 Calm-Status). No invented visuals.

**Interfaces:**
- Consumes: `mapStep`, `PIPELINE_STEPS`, `StepView` (Task 1); `getItemProgress` (existing).
- Produces: `PipelineStepper({ view, lastError, itemId }: { view: StepView; lastError: string | null; itemId: string })`.

- [ ] **Step 1: Add i18n keys**

Add a new `pipeline` namespace to BOTH message files. zh.json:

```json
"pipeline": {
  "fetch": "抓取",
  "extract": "提取",
  "embed": "嵌入",
  "score": "打分",
  "done": "完成",
  "failedAt": "在「{step}」失败",
  "retry": "重试"
}
```

en.json:

```json
"pipeline": {
  "fetch": "Fetch",
  "extract": "Extract",
  "embed": "Embed",
  "score": "Score",
  "done": "Done",
  "failedAt": "Failed at {step}",
  "retry": "Retry"
}
```

- [ ] **Step 2: Write the stepper view (dumb, logic-free)**

```tsx
// apps/web/components/PipelineStepper.tsx
'use client';

import { useTranslations } from 'next-intl';
import { PIPELINE_STEPS, type StepView } from '@benkyou/core/items';
import { retryItemAction } from '@/app/(authed)/admin/jobs/actions';

// Calm-Status dots (DESIGN.md §5): muted+pulse = active, accent = complete,
// faint = pending, err = failed. No flashing on failed (static err dot).
export function PipelineStepper({
  view,
  lastError,
  itemId,
}: {
  view: StepView;
  lastError: string | null;
  itemId: string;
}) {
  const t = useTranslations('pipeline');
  const ti = useTranslations('item');

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        {PIPELINE_STEPS.map((step, i) => {
          const complete = !view.failed && i < view.activeIndex;
          const active = !view.failed && i === view.activeIndex;
          const failed = view.failed && i === view.activeIndex;
          const dot = failed
            ? 'bg-err'
            : complete
              ? 'bg-accent'
              : active
                ? 'bg-muted animate-pulse motion-reduce:animate-none'
                : 'bg-faint';
          const label = failed || active ? 'text-ink' : complete ? 'text-muted' : 'text-faint';
          return (
            <li key={step} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className="text-faint">—</span>}
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              <span className={label}>{t(step)}</span>
              {active && view.transcriptSub ? (
                <span className="text-xs text-muted">· {ti(`transcript.${view.transcriptSub}` as 'transcript.pending')}</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {view.failed ? (
        <div className="flex flex-col gap-2">
          {lastError ? <pre className="whitespace-pre-wrap text-xs text-muted">{lastError}</pre> : null}
          <form action={retryItemAction}>
            <input type="hidden" name="itemId" value={itemId} />
            <button
              type="submit"
              className="self-start rounded-md border border-line px-3 py-1 text-sm text-ink"
            >
              {t('retry')}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Wire into the item processing view**

In `apps/web/app/(authed)/items/[id]/page.tsx`, replace the processing-view block (the `if (!item)` branch's `<p>`/`<pre>` lines) with the stepper. Import at top: `import { getItemProgress, mapStep } from '@benkyou/core/items';` and `import { PipelineStepper } from '@/components/PipelineStepper';`. The branch becomes:

```tsx
  if (!item) {
    const progress = await getItemProgress(id);
    if (!progress) notFound();
    const view = mapStep(progress.state, progress.currentStage, progress.transcriptStatus, progress.lastError);
    return (
      <main className="flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <h1 className="font-serif text-2xl leading-snug font-semibold text-balance text-ink">
            {t('processingTitle')}
          </h1>
          <AutoRefresh />
        </header>
        <p className="text-sm text-muted">{progress.title}</p>
        <PipelineStepper view={view} lastError={progress.lastError} itemId={progress.id} />
      </main>
    );
  }
```

(`mapStep` is safe to call in a server component — it's a pure function. The existing `t('processingStage'...)` / `t('processingFailed'...)` keys are now unused by this page but leave them in the message files; other call sites or tests may reference them — removing keys risks a check:i18n / test break.)

- [ ] **Step 4: Verify it builds + manual check**

Run: `pnpm --filter @benkyou/web typecheck && pnpm check:i18n`
Expected: no type errors; i18n consistent.

Manual (golden path + edges): `pnpm --filter @benkyou/web dev`, paste a URL, open `/items/[id]` while processing → see ① ✓ ② ● dots advance on auto-refresh; force a failure (e.g. an unreachable URL) → red dot at the failed step + error line + working retry button; a video item → extract step shows the transcript sub-label.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/PipelineStepper.tsx apps/web/app/(authed)/items/[id]/page.tsx apps/web/messages/
git commit -m "feat(web): 5-step pipeline stepper on the item processing view"
```

---

### Task 9: `SourcePipelineStatus` — per-source compact status + expand

**Files:**
- Create: `apps/web/app/(authed)/sources/SourcePipelineStatus.tsx`
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`

🔧 Derivative. Consumed by the RSS source-type block in Task 11.

**Interfaces:**
- Consumes: `getSourcePipelineStatus` (Task 2) — called by the parent (Task 11) and passed in as a prop; `PIPELINE_STEPS` for step labels; `retryItemAction`.
- Produces: `SourcePipelineStatus({ status }: { status: SourcePipelineStatusData })` where `SourcePipelineStatusData` is the core `SourcePipelineStatus` type (imported and re-aliased to avoid name clash with the component).

- [ ] **Step 1: Add i18n keys**

Add to the `sources` namespace in BOTH files. zh.json (`sources`):

```json
"statusInFlight": "处理中 {n}",
"statusDone": "完成 {n}",
"statusFailed": "失败 {n}",
"allDone": "全部完成 {n}",
"expandStatus": "展开处理详情",
"failedExtract": "提取失败"
```

en.json (`sources`):

```json
"statusInFlight": "{n} processing",
"statusDone": "{n} done",
"statusFailed": "{n} failed",
"allDone": "All done · {n}",
"expandStatus": "Show processing detail",
"failedExtract": "Extract failed"
```

- [ ] **Step 2: Write the component**

```tsx
// apps/web/app/(authed)/sources/SourcePipelineStatus.tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PIPELINE_STEPS, type SourcePipelineStatus as SourcePipelineStatusData } from '@benkyou/core/items';
import { retryItemAction } from '../admin/jobs/actions';

export async function SourcePipelineStatus({ status }: { status: SourcePipelineStatusData }) {
  const t = await getTranslations('sources');
  const tp = await getTranslations('pipeline');
  const calm = status.inFlight.length === 0 && status.failed.length === 0;

  if (calm) {
    return <span className="text-xs text-muted">{t('allDone', { n: status.doneCount })}</span>;
  }

  return (
    <details className="text-xs">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-muted">
        {status.inFlight.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted animate-pulse motion-reduce:animate-none" />
            {t('statusInFlight', { n: status.inFlight.length })}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          {t('statusDone', { n: status.doneCount })}
        </span>
        {status.failed.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-err">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-err" />
            {t('statusFailed', { n: status.failed.length })}
          </span>
        )}
      </summary>

      <ul className="mt-2 flex flex-col gap-1.5 border-l border-line pl-3">
        {status.inFlight.map((i) => (
          <li key={i.itemId} className="flex items-center justify-between gap-3">
            <Link href={`/items/${i.itemId}`} className="truncate text-muted hover:text-ink">
              {i.title}
            </Link>
            <span className="shrink-0 text-faint">{tp(PIPELINE_STEPS[i.step] ?? 'done')}</span>
          </li>
        ))}
        {status.failed.map((f) => (
          <li key={f.itemId} className="flex items-center justify-between gap-3 text-err">
            <span className="truncate">{f.title}</span>
            <form action={retryItemAction} className="shrink-0">
              <input type="hidden" name="itemId" value={f.itemId} />
              <button type="submit" className="rounded-md border border-line px-2 py-0.5 text-faint">
                {tp('retry')}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}
```

(`PIPELINE_STEPS[i.step]` is `string | undefined` under `noUncheckedIndexedAccess`; the `?? 'done'` guard keeps it well-typed. `i.step === 5` (fully done) cannot appear in `inFlight`, but the guard is cheap.)

- [ ] **Step 3: Verify build + i18n**

Run: `pnpm --filter @benkyou/web typecheck && pnpm check:i18n`
Expected: clean. (Visual verification happens in Task 11 when it's mounted in the page.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(authed)/sources/SourcePipelineStatus.tsx apps/web/messages/
git commit -m "feat(web): per-source calm pipeline status with expandable detail"
```

---

# Phase C — Sources IA rebuild (registry-driven)

### Task 10: Source-type block + adhoc card + overview bar (presentational shells)

**Files:**
- Create: `apps/web/app/(authed)/sources/SourcesOverviewBar.tsx`
- Create: `apps/web/app/(authed)/sources/SourceTypeBlock.tsx`
- Create: `apps/web/app/(authed)/sources/AdhocCard.tsx`
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`

🔧 Derivative structurally, but the per-platform block, overview bar, and adhoc card are **net-new surfaces** — build them as structurally-neutral shells composed only from existing tokens. Where a primitive is missing, mark `{/* DESIGN-GAP: … */}`. Do not invent visual values.

**Interfaces:**
- Consumes: `SOURCE_TYPE_CATALOG`, `SourceTypeInfo` (Task 4); `SourceWithStats` (existing); `getSourcePipelineStatus` (Task 2); `SourcePipelineStatus` component (Task 9); `AddSourceForm` / `EditSourceForm` / `DeleteSourceForm` (Task 11 will retoken them — for now import as-is).
- Produces: `SourcesOverviewBar({ total, enabled, failed })`; `SourceTypeBlock({ info, sources, statuses })` where `statuses: Record<string, SourcePipelineStatusData>`; `AdhocCard({ adhocWeight, count })`.

- [ ] **Step 1: Add i18n keys**

zh.json (`sources`):

```json
"overview": "总览",
"overviewCounts": "{total} 源 · 启用 {enabled} · 失败 {failed}",
"rssTitle": "RSS 订阅源",
"addRss": "+ 添加 RSS",
"plannedBadge": "{milestone} · 规划中",
"adhocTitle": "手动导入",
"adhocSubtitle": "无需轮询",
"adhocCount": "累计 {n} 条",
"adhocWeightLabel": "手动权重",
"adhocWeightHelp": "你手动粘贴的内容在排序里的权重",
"pasteUrl": "粘贴 URL",
"typeName": {
  "youtube": "YouTube 频道",
  "bilibili": "Bilibili 频道",
  "hn": "Hacker News",
  "reddit": "Reddit"
}
```

en.json (`sources`):

```json
"overview": "Overview",
"overviewCounts": "{total} sources · {enabled} enabled · {failed} failing",
"rssTitle": "RSS feeds",
"addRss": "+ Add RSS",
"plannedBadge": "{milestone} · planned",
"adhocTitle": "Manual import",
"adhocSubtitle": "no polling",
"adhocCount": "{n} items total",
"adhocWeightLabel": "Manual weight",
"adhocWeightHelp": "Weight of items you paste in manually, in ranking",
"pasteUrl": "Paste URL",
"typeName": {
  "youtube": "YouTube channels",
  "bilibili": "Bilibili channels",
  "hn": "Hacker News",
  "reddit": "Reddit"
}
```

- [ ] **Step 2: Write `SourcesOverviewBar`**

```tsx
// apps/web/app/(authed)/sources/SourcesOverviewBar.tsx
import { getTranslations } from 'next-intl/server';

export async function SourcesOverviewBar({
  total,
  enabled,
  failed,
}: {
  total: number;
  enabled: number;
  failed: number;
}) {
  const t = await getTranslations('sources');
  return (
    <div className="flex items-baseline gap-3 border-b border-line pb-3 text-sm">
      <span className="text-xs font-medium uppercase tracking-wider text-faint">{t('overview')}</span>
      <span className="text-muted">{t('overviewCounts', { total, enabled, failed })}</span>
    </div>
  );
}
```

- [ ] **Step 3: Write `SourceTypeBlock`**

```tsx
// apps/web/app/(authed)/sources/SourceTypeBlock.tsx
import { getTranslations } from 'next-intl/server';
import type { SourceTypeInfo } from '@benkyou/core/sources';
import type { SourceWithStats } from '@benkyou/core/sources';
import type { SourcePipelineStatus as SourcePipelineStatusData } from '@benkyou/core/items';
import { AddSourceForm } from './AddSourceForm';
import { SourceList } from './SourceList';

// One block per catalog entry (spec §2.2). Implemented types render their feed
// list + add form; planned types render a disabled placeholder labelled with the
// owning milestone (prevents the "RSS manager" misread; spec §10).
export async function SourceTypeBlock({
  info,
  sources,
  statuses,
}: {
  info: SourceTypeInfo;
  sources: SourceWithStats[];
  statuses: Record<string, SourcePipelineStatusData>;
}) {
  const t = await getTranslations('sources');
  const title = info.type === 'rss' ? t('rssTitle') : t(`typeName.${info.type}` as 'typeName.youtube');

  if (info.status === 'planned') {
    return (
      <section className="flex items-center justify-between rounded-md border border-line px-4 py-3 text-sm opacity-60">
        <span className="text-muted">{title}</span>
        <span className="text-xs text-faint">{t('plannedBadge', { milestone: info.milestone ?? '' })}</span>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-ink">
          {title} <span className="text-sm font-normal text-faint">({sources.length})</span>
        </h2>
        {/* DESIGN-GAP: inline add-form disclosure styling — neutral <details> for now */}
        <details>
          <summary className="cursor-pointer text-sm text-accent">{t('addRss')}</summary>
          <div className="mt-2">
            <AddSourceForm />
          </div>
        </details>
      </div>
      <SourceList sources={sources} statuses={statuses} />
    </section>
  );
}
```

- [ ] **Step 4: Write `AdhocCard`**

```tsx
// apps/web/app/(authed)/sources/AdhocCard.tsx
import { getTranslations } from 'next-intl/server';
import { AdhocWeightForm } from './AdhocWeightForm';

// The manual-import pseudo-source (spec §2.2): NOT a sources row. Surfaces the
// adhoc_source_weight knob + its explanation + cumulative count + paste shortcut.
export async function AdhocCard({ adhocWeight, count }: { adhocWeight: string; count: number }) {
  const t = await getTranslations('sources');
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-ink">{t('adhocTitle')}</h2>
        <span className="text-xs text-faint">
          {t('adhocCount', { n: count })} · {t('adhocSubtitle')}
        </span>
      </div>
      <AdhocWeightForm defaultWeight={adhocWeight} />
    </section>
  );
}
```

(`AdhocWeightForm` and the paste-shortcut button are added in Task 12 / Task 16; for now `AdhocCard` references `AdhocWeightForm` which Task 12 creates. Mark a `{/* DESIGN-GAP */}` if you stub it. To keep this task self-contained and compiling, also create the minimal `AdhocWeightForm` stub in Step 5.)

- [ ] **Step 5: Create a minimal `AdhocWeightForm` stub so this task compiles**

```tsx
// apps/web/app/(authed)/sources/AdhocWeightForm.tsx
'use client';

import { useTranslations } from 'next-intl';
import { updateAdhocWeightAction } from './actions';

export function AdhocWeightForm({ defaultWeight }: { defaultWeight: string }) {
  const t = useTranslations('sources');
  return (
    <form action={updateAdhocWeightAction} className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-sm text-ink">
        <span>{t('adhocWeightLabel')}</span>
        <input
          name="adhocSourceWeight"
          type="number"
          step="0.1"
          min="0"
          defaultValue={defaultWeight}
          className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
        />
        <button type="submit" className="rounded-md border border-line px-2 py-1 text-sm text-ink">
          {t('save')}
        </button>
      </label>
      <p className="text-xs text-muted">{t('adhocWeightHelp')}</p>
    </form>
  );
}
```

(`updateAdhocWeightAction` is added in Task 12. Until then this won't be wired into a page, so it won't break runtime; typecheck needs the action to exist — so **do Task 12's action step before typechecking**, or temporarily import-guard. Cleanest: this task and Task 12 are committed together if executed inline. For subagent execution, treat Tasks 10+12 as a pair.)

- [ ] **Step 6: Defer compile/verify to Task 11/12**

These shells are mounted and verified in Task 11 (page assembly). Commit now:

```bash
git add apps/web/app/(authed)/sources/SourcesOverviewBar.tsx apps/web/app/(authed)/sources/SourceTypeBlock.tsx apps/web/app/(authed)/sources/AdhocCard.tsx apps/web/app/(authed)/sources/AdhocWeightForm.tsx apps/web/messages/
git commit -m "feat(web): source-type block, overview bar, adhoc card shells"
```

---

### Task 11: Assemble registry-driven `/sources` page; retoken source forms

**Files:**
- Modify: `apps/web/app/(authed)/sources/page.tsx`
- Modify: `apps/web/app/(authed)/sources/SourceList.tsx`
- Modify: `apps/web/app/(authed)/sources/AddSourceForm.tsx`
- Modify: `apps/web/app/(authed)/sources/EditSourceForm.tsx`
- Modify: `apps/web/app/(authed)/sources/DeleteSourceForm.tsx`
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`

🔧 Derivative + token cleanup (spec §8: these forms are slated for retoken anyway). All `slate-*`/`red-*`/`green-*` → semantic tokens.

**Interfaces:**
- Consumes: `listSourcesWithStats`, `getSourcePipelineStatus`, `SOURCE_TYPE_CATALOG`, `getUserSettings`; Task 10 components.
- Produces: a `SourceList` that accepts `statuses` and renders `SourcePipelineStatus` per row; `poll_interval` exposure in add/edit forms.

- [ ] **Step 1: Rewrite the page (registry-driven)**

```tsx
// apps/web/app/(authed)/sources/page.tsx
import { listSourcesWithStats, SOURCE_TYPE_CATALOG } from '@benkyou/core/sources';
import { getSourcePipelineStatus, type SourcePipelineStatus } from '@benkyou/core/items';
import { getUserSettings } from '@benkyou/core/settings';
import { getTranslations } from 'next-intl/server';
import { AutoRefresh } from '@/components/AutoRefresh';
import { SourcesOverviewBar } from './SourcesOverviewBar';
import { SourceTypeBlock } from './SourceTypeBlock';
import { AdhocCard } from './AdhocCard';

export default async function SourcesPage() {
  const t = await getTranslations('sources');
  const [sources, settings] = await Promise.all([listSourcesWithStats(), getUserSettings()]);

  const enabled = sources.filter((s) => s.enabled).length;
  const failed = sources.filter((s) => s.lastFetchError || s.consecutiveFailures > 0).length;

  // Per-source pipeline status only for implemented types' sources (cheap; single user).
  const statusEntries = await Promise.all(
    sources.map(async (s): Promise<[string, SourcePipelineStatus]> => [s.id, await getSourcePipelineStatus(s.id)]),
  );
  const statuses = Object.fromEntries(statusEntries);

  const adhocCount = settings ? await getAdhocCount() : 0;

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-xl font-semibold text-ink">{t('title')}</h1>
        <AutoRefresh />
      </div>
      <SourcesOverviewBar total={sources.length} enabled={enabled} failed={failed} />

      {SOURCE_TYPE_CATALOG.map((info) => (
        <SourceTypeBlock
          key={info.type}
          info={info}
          sources={sources.filter((s) => s.type === info.type)}
          statuses={statuses}
        />
      ))}

      <AdhocCard adhocWeight={settings?.adhocSourceWeight ?? '1.0'} count={adhocCount} />
    </main>
  );
}
```

Add a tiny `getAdhocCount` to core (`packages/core/src/items/queries.ts`): `COUNT(items WHERE source_id IS NULL)`, re-exported from `items/index.ts`:

```ts
export async function getAdhocCount(): Promise<number> {
  const db = getDbClient();
  const rows = await db.select({ c: sql<number>`count(*)::int` }).from(items).where(sql`${items.sourceId} IS NULL`);
  return rows[0]?.c ?? 0;
}
```

Import it on the page: `import { ..., getAdhocCount } from '@benkyou/core/items';`.

- [ ] **Step 2: Rewrite `SourceList` to take `statuses` and use tokens**

```tsx
// apps/web/app/(authed)/sources/SourceList.tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { SourceWithStats } from '@benkyou/core/sources';
import type { SourcePipelineStatus as SourcePipelineStatusData } from '@benkyou/core/items';
import { toggleSourceAction, fetchSourceNowAction } from './actions';
import { EditSourceForm } from './EditSourceForm';
import { DeleteSourceForm } from './DeleteSourceForm';
import { SourcePipelineStatus } from './SourcePipelineStatus';

export async function SourceList({
  sources,
  statuses,
}: {
  sources: SourceWithStats[];
  statuses: Record<string, SourcePipelineStatusData>;
}) {
  const t = await getTranslations('sources');
  if (sources.length === 0) return <p className="text-sm text-muted">{t('empty')}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {sources.map((s) => (
        <li key={s.id} className="flex flex-col gap-2 py-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold text-ink">{s.name}</span>
            <a href={s.url} className="max-w-xs truncate text-muted" target="_blank" rel="noreferrer">{s.url}</a>
            <span className="text-faint">w{s.weight}</span>
            <span className="text-faint">{pollLabel(s.pollInterval)}</span>
            <form action={toggleSourceAction}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="enabled" value={String(!s.enabled)} />
              <button type="submit" className="rounded-md border border-line px-2 py-0.5 text-ink">
                {s.enabled ? t('pause') : t('enable')}
              </button>
            </form>
            <Link href={`/?source=${s.id}`} className="text-muted underline-offset-2 hover:underline">
              {t('itemCount', { count: s.itemCount })}
            </Link>
            <form action={fetchSourceNowAction} className="ml-auto">
              <input type="hidden" name="id" value={s.id} />
              <button type="submit" className="rounded-md border border-line px-2 py-0.5 text-ink">{t('fetchNow')}</button>
            </form>
            <DeleteSourceForm id={s.id} />
          </div>

          {statuses[s.id] ? <SourcePipelineStatus status={statuses[s.id]!} /> : null}
          {s.lastFetchError ? (
            <details className="text-xs text-err">
              <summary className="cursor-pointer">✗ {t('fetchError')}</summary>
              <pre className="whitespace-pre-wrap">{s.lastFetchError}</pre>
            </details>
          ) : null}

          <details>
            <summary className="cursor-pointer text-sm text-muted">{t('edit')}</summary>
            <EditSourceForm
              id={s.id}
              defaults={{ name: s.name, url: s.url, weight: s.weight ?? '1', pollInterval: s.pollInterval ?? 1800 }}
            />
          </details>
        </li>
      ))}
    </ul>
  );
}

// poll_interval is seconds in the DB; show minutes/hours (spec §5.2).
function pollLabel(seconds: number | null): string {
  const s = seconds ?? 1800;
  return s % 3600 === 0 ? `${s / 3600}h` : `${Math.round(s / 60)}m`;
}
```

(`statuses[s.id]!` — the `!` is safe because the page populates `statuses` for every source; under `noUncheckedIndexedAccess` the `statuses[s.id] ?` guard already proved presence, so prefer `const st = statuses[s.id]; ... {st ? <SourcePipelineStatus status={st} /> : null}` to avoid the non-null assertion. Use the local-const form.)

- [ ] **Step 3: Retoken + extend `AddSourceForm` / `EditSourceForm` with `poll_interval`**

Read both files. Convert all `slate-*`/`red-*` classes to tokens (`border-line`, `text-ink`, `text-muted`, `text-err`, `bg-surface`, `bg-accent-vivid` for the submit button per DESIGN.md button-primary). Add a `pollInterval` field (a `<select>` of common intervals: 15m/30m/1h/6h/24h → values 900/1800/3600/21600/86400) with the help text `pollIntervalHelp`. `EditSourceForm`'s `defaults` prop type gains `pollInterval: number`. Add new i18n keys:

zh.json (`sources`): `"pollIntervalLabel": "拉取频率"`, `"pollIntervalHelp": "每隔多久自动拉取一次该源（默认 30 分钟）"`, `"weightHelp": "越高 → 该源内容在排序里越靠前"`.
en.json (`sources`): `"pollIntervalLabel": "Fetch frequency"`, `"pollIntervalHelp": "How often this source is auto-fetched (default 30 min)"`, `"weightHelp": "Higher → this source ranks earlier"`.

- [ ] **Step 4: Retoken `DeleteSourceForm`**

Read it; convert `slate-*`/`red-*` to tokens. The destructive confirm stays calm (an `--err`-text confirm, not a red block).

- [ ] **Step 5: Update `sources/actions.ts` to carry `pollInterval` (+ draft on bootstrap)**

In `addSourceAction` and `editSourceAction`, extend the zod schema with `pollInterval: z.coerce.number().int().positive().optional()` and pass it through. In `addSourceAction`, gate draft creation on readiness:

```ts
import { getUserSettings, isAiConfigured } from '@benkyou/core/settings';
// ...inside addSourceAction, after parse:
const settings = await getUserSettings();
const enabled = settings ? isAiConfigured(settings) : false; // draft (paused) until AI configured (spec §4.4)
const id = await createSource({ ...parsed.data, enabled });
if (enabled) await triggerSourceFetch(id); // don't kick a pipeline that would fail without AI
```

(When `enabled` is false the source is a draft; the poll loop skips it and no fetch is triggered — so no item runs into `failed` pre-AI, per spec §4.4 "不造假失败".)

- [ ] **Step 6: Verify build + i18n + manual**

Run: `pnpm --filter @benkyou/core typecheck && pnpm --filter @benkyou/web typecheck && pnpm check:i18n`
Expected: clean.

Manual: `/sources` shows overview bar; RSS block lists feeds with weight + poll label + per-source calm status (expandable); planned blocks (YouTube/Bilibili/HN/Reddit) render disabled with milestone labels; adhoc card shows weight + count. Add a source while AI is configured → it fetches; (test draft path in Task 14).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/(authed)/sources/ packages/core/src/items/queries.ts packages/core/src/items/index.ts apps/web/messages/
git commit -m "feat(web): registry-driven /sources with per-source status, poll/weight exposure, tokens"
```

---

# Phase D — Settings sectioning

### Task 12: Section `/settings`; adhoc-weight + ranking actions

**Files:**
- Modify: `apps/web/app/(authed)/settings/page.tsx`
- Modify: `apps/web/app/(authed)/settings/SettingsForm.tsx` (split into sections)
- Create: `apps/web/app/(authed)/settings/sections/AiServicesSection.tsx`
- Create: `apps/web/app/(authed)/settings/sections/RankingSection.tsx`
- Create: `apps/web/app/(authed)/settings/sections/InterestsSection.tsx`
- Create: `apps/web/app/(authed)/settings/sections/AppearanceSection.tsx`
- Modify: `apps/web/app/(authed)/settings/actions.ts`
- Modify: `apps/web/app/(authed)/sources/actions.ts` (add `updateAdhocWeightAction`)
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`

🎨/🔧 mixed: the section IA is net-new but composes existing form primitives. The AI-services section reuses the existing connectivity-test action logic verbatim — do not reinvent it.

**Interfaces:**
- Consumes: `getUserSettings`, `RANKING_PRESETS`, `matchPreset`, `updateSettingsAction` (existing).
- Produces: `updateRankingAction`, `updateInterestsAction`, `updateAppearanceAction` (server actions writing focused `SettingsPatch` subsets); `updateAdhocWeightAction` (in sources/actions.ts). New section components, each a logic-free view fed by props + bound to one action.

> **Decomposition note:** the current `updateSettingsAction` validates and writes *all* fields at once. Sectioning means a section should be saveable on its own. The lowest-risk approach: keep `updateSettingsAction` as the **AI-services** save (it already does connectivity tests + dim check), and add small, separate actions for ranking / interests / appearance that write only their columns via `updateSettings(patch)` (no connectivity test needed for those). This avoids forcing a full AI re-test when changing a preset.

- [ ] **Step 1: Add i18n keys**

zh.json — extend `settings`:

```json
"aiSection": "AI 服务",
"rankingSection": "排序与打分",
"interestsSection": "兴趣标签",
"appearanceSection": "外观与语言",
"accountSection": "账户安全",
"rankingStyle": "排序风格",
"rankingHelp": "决定 feed 智能排序 / 日报 / 搜索怎么排。",
"preset": { "balanced": "均衡", "relevance": "偏相关", "depth": "偏深度", "source": "偏高权重源", "custom": "自定义" },
"advancedWeights": "高级:自定义权重 α/β/γ",
"alpha": "α 相关", "beta": "β 深度", "gamma": "γ 来源",
"interestsHelp": "用于算「相关性」分,影响日报与智能排序。",
"theme": "深色模式", "themeSystem": "跟随系统", "themeLight": "浅色", "themeDark": "深色"
```

en.json — extend `settings`:

```json
"aiSection": "AI services",
"rankingSection": "Ranking & scoring",
"interestsSection": "Interest tags",
"appearanceSection": "Appearance & language",
"accountSection": "Account & security",
"rankingStyle": "Ranking style",
"rankingHelp": "Controls how the feed, digest, and search are ordered.",
"preset": { "balanced": "Balanced", "relevance": "Relevance", "depth": "Depth", "source": "Source weight", "custom": "Custom" },
"advancedWeights": "Advanced: custom α/β/γ weights",
"alpha": "α relevance", "beta": "β depth", "gamma": "γ source",
"interestsHelp": "Used for the relevance score; affects digest and smart ranking.",
"theme": "Dark mode", "themeSystem": "Follow system", "themeLight": "Light", "themeDark": "Dark"
```

- [ ] **Step 2: Add the focused server actions (`settings/actions.ts`)**

Append three actions that write only their columns (no connectivity test):

```ts
import { RANKING_PRESETS, type RankingPreset } from '@benkyou/core/settings';

export async function updateRankingAction(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  await requireAuth();
  const preset = String(fd.get('preset') ?? '');
  if (preset in RANKING_PRESETS) {
    const w = RANKING_PRESETS[preset as RankingPreset];
    await updateSettings({ weightAlpha: String(w.alpha), weightBeta: String(w.beta), weightGamma: String(w.gamma) });
  } else {
    // custom: read the three numbers (spec §5.3 advanced fold)
    const num = (k: string): string => String(Number(fd.get(k) ?? 0));
    await updateSettings({ weightAlpha: num('alpha'), weightBeta: num('beta'), weightGamma: num('gamma') });
  }
  revalidatePath('/settings');
  return { ok: true };
}

export async function updateInterestsAction(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  await requireAuth();
  const tags = String(fd.get('interestTags') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  await updateSettings({ interestTags: tags });
  revalidatePath('/settings');
  return { ok: true };
}

export async function updateAppearanceAction(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  await requireAuth();
  const locale = fd.get('locale') === 'en' ? 'en' : 'zh';
  await updateSettings({ locale });
  revalidatePath('/settings');
  return { ok: true };
}
```

(Theme override is client-side via `data-theme` on `<html>` per globals.css comment — the AppearanceSection sets it through a small client control; no DB column. Locale is persisted.)

- [ ] **Step 3: Add `updateAdhocWeightAction` (`sources/actions.ts`)**

```ts
import { updateSettings } from '@benkyou/core/settings';

export async function updateAdhocWeightAction(fd: FormData): Promise<void> {
  await requireAuth();
  const w = Number(fd.get('adhocSourceWeight') ?? '1');
  if (!Number.isFinite(w) || w < 0) return;
  await updateSettings({ adhocSourceWeight: String(w) });
  revalidatePath('/sources');
}
```

- [ ] **Step 4: Extract the AI-services section**

Move the existing `SettingsForm` field markup (LLM/embedding/reader + dim note + connectivity test, bound to `updateSettingsAction`) into `sections/AiServicesSection.tsx`, retokened (replace the `field` constant `slate-*` classes with token equivalents; the submit button uses `bg-accent-vivid text-bg`). Keep the `embed_dim` note read-only. This is the spec §8 retoken of `SettingsForm`. Keep `SettingsForm.tsx` as a thin re-export shim or delete it and update imports — prefer deleting and importing the section directly.

- [ ] **Step 5: Write `RankingSection` (preset radios + advanced fold)**

```tsx
// apps/web/app/(authed)/settings/sections/RankingSection.tsx
'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { matchPreset, RANKING_PRESETS, type RankingPreset } from '@benkyou/core/settings';
import { updateRankingAction, type SettingsState } from '../actions';

const PRESETS = Object.keys(RANKING_PRESETS) as RankingPreset[];

export function RankingSection({ weights }: { weights: { alpha: number; beta: number; gamma: number } }) {
  const t = useTranslations('settings');
  const [state, action] = useActionState<SettingsState, FormData>(updateRankingAction, {});
  const current = matchPreset(weights);

  return (
    <form action={action} className="flex flex-col gap-3 text-sm">
      <span className="text-ink">{t('rankingStyle')}</span>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <label key={p} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-muted">
            <input type="radio" name="preset" value={p} defaultChecked={current === p} />
            {t(`preset.${p}` as 'preset.balanced')}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted">{t('rankingHelp')}</p>

      <details>
        <summary className="cursor-pointer text-sm text-accent">{t('advancedWeights')}</summary>
        <div className="mt-2 flex flex-wrap gap-3">
          {(['alpha', 'beta', 'gamma'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-muted">
              {t(k)}
              <input
                name={k}
                type="number"
                step="0.05"
                min="0"
                defaultValue={weights[k]}
                className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-ink"
              />
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-faint">{current === 'custom' ? t('preset.custom') : ''}</p>
      </details>

      <button type="submit" className="self-start rounded-md bg-accent-vivid px-4 py-1.5 text-bg">
        {t('save')}
      </button>
      {state.ok ? <p className="text-xs text-accent">{t('saved')}</p> : null}
    </form>
  );
}
```

(When the advanced fields are submitted, `preset` is still present from the radios. To make "edit α/β/γ" win over the radio, the advanced submit should clear the preset choice — simplest: a separate submit button inside the fold that sets a hidden `preset=custom`. Implement that: inside `<details>` add `<input type="hidden" name="preset" value="custom" />` is wrong because it'd always send custom. Instead give the advanced fold its **own** `<form action={action}>` with only the three numbers + `preset` omitted → `updateRankingAction` falls to the else branch. Refactor into two forms sharing the action. Keep it simple and correct.)

- [ ] **Step 6: Write `InterestsSection` + `AppearanceSection`**

`InterestsSection`: a one-field form (comma-separated tags) bound to `updateInterestsAction` + `interestsHelp`. `AppearanceSection`: a locale `<select>` bound to `updateAppearanceAction` + a theme control (3-way: system/light/dark) that sets `document.documentElement.dataset.theme` and persists to `localStorage` (client-only; matches globals.css `data-theme` hook). Both token-styled.

- [ ] **Step 7: Reassemble `settings/page.tsx`**

```tsx
// apps/web/app/(authed)/settings/page.tsx
import { getTranslations } from 'next-intl/server';
import { getUserSettings } from '@benkyou/core/settings';
import { AiServicesSection } from './sections/AiServicesSection';
import { RankingSection } from './sections/RankingSection';
import { InterestsSection } from './sections/InterestsSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { PasswordForm } from './PasswordForm';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const t = await getTranslations('settings');
  const settings = await getUserSettings();
  if (!settings) return null;
  const { llmApiKey, embedApiKey, readerApiKey, ...safe } = settings;
  const weights = {
    alpha: Number(settings.weightAlpha ?? '0.6'),
    beta: Number(settings.weightBeta ?? '0.3'),
    gamma: Number(settings.weightGamma ?? '0.1'),
  };

  return (
    <main className="flex flex-col gap-10">
      <h1 className="font-serif text-xl font-semibold text-ink">{t('title')}</h1>
      <Section title={t('aiSection')}>
        <AiServicesSection
          settings={{ ...safe, llmApiKeyConfigured: Boolean(llmApiKey), embedApiKeyConfigured: Boolean(embedApiKey), readerApiKeyConfigured: Boolean(readerApiKey) }}
          embedDim={settings.embedDim}
        />
      </Section>
      <Section title={t('rankingSection')}><RankingSection weights={weights} /></Section>
      <Section title={t('interestsSection')}><InterestsSection tags={settings.interestTags ?? []} /></Section>
      <Section title={t('appearanceSection')}><AppearanceSection locale={settings.locale as 'zh' | 'en'} /></Section>
      <Section title={t('accountSection')}><PasswordForm /></Section>
    </main>
  );
}
```

- [ ] **Step 8: Verify build + i18n + manual**

Run: `pnpm --filter @benkyou/web typecheck && pnpm check:i18n`
Manual: each section saves independently; ranking preset radios reflect stored weights; advanced fold edits write custom α/β/γ and the preset chip flips to "custom"; locale change persists; theme toggle flips `data-theme`. `embed_dim` shows read-only.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/(authed)/settings/ apps/web/app/(authed)/sources/actions.ts apps/web/messages/
git commit -m "feat(web): sectioned /settings (AI, ranking presets, interests, appearance, account)"
```

---

# Phase E — Onboarding + readiness gating

### Task 13: `OnboardingChecklist` + feed integration

**Files:**
- Create: `apps/web/components/OnboardingChecklist.tsx`
- Modify: `apps/web/app/(authed)/page.tsx`
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`

🎨 net-new surface — build a structurally-neutral shell from tokens; mark `{/* DESIGN-GAP */}` where the kit lacks a primitive (e.g. the checklist card chrome). The completion logic is server-derived; the card is a logic-free view + a localStorage dismiss hook.

**Interfaces:**
- Consumes: `getOnboardingState` (Task 7).
- Produces: `OnboardingChecklist({ state }: { state: OnboardingState })` (client component; reads/writes `localStorage['bk_onboarding_dismissed']`; re-shows while incomplete).

- [ ] **Step 1: Add i18n keys**

zh.json (new `onboarding` namespace):

```json
"onboarding": {
  "title": "开始使用",
  "step1": "配置 AI 服务",
  "step2": "添加第一个源",
  "step3": "看它处理入库",
  "dismiss": "暂时收起",
  "done": "✓"
}
```

en.json:

```json
"onboarding": {
  "title": "Get started",
  "step1": "Configure AI services",
  "step2": "Add your first source",
  "step3": "Watch it process",
  "dismiss": "Hide for now",
  "done": "✓"
}
```

- [ ] **Step 2: Write the checklist (client; localStorage dismiss; re-shows until complete)**

```tsx
// apps/web/components/OnboardingChecklist.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { OnboardingState } from '@benkyou/core/onboarding';

const KEY = 'bk_onboarding_dismissed';

export function OnboardingChecklist({ state }: { state: OnboardingState }) {
  const t = useTranslations('onboarding');
  const allDone = state.aiConfigured && (state.hasSource || state.hasItem) && state.hasDone;
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid SSR flash
  useEffect(() => {
    setDismissed(localStorage.getItem(KEY) === '1');
  }, []);

  // Re-appears until truly complete (spec §4.3): dismissal is per-visit, not permanent.
  if (allDone || dismissed) return null;

  const steps = [
    { key: 'step1', href: '/settings', done: state.aiConfigured },
    { key: 'step2', href: '/sources', done: state.hasSource || state.hasItem },
    { key: 'step3', href: '/sources', done: state.hasDone },
  ] as const;

  return (
    // DESIGN-GAP: onboarding card chrome — neutral surface-2 panel for now.
    <aside className="mb-6 flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-ink">{t('title')}</h2>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(KEY, '1');
            setDismissed(true);
          }}
          className="text-xs text-muted hover:text-ink"
        >
          {t('dismiss')}
        </button>
      </div>
      <ol className="flex flex-col gap-2 text-sm">
        {steps.map(({ key, href, done }, i) => (
          <li key={key} className="flex items-center gap-2">
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${done ? 'bg-accent' : 'bg-faint'}`} />
            {done ? (
              <span className="text-muted">{t('done')} {t(key)}</span>
            ) : (
              <Link href={href} className="text-accent hover:underline">
                {i + 1}. {t(key)}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
```

- [ ] **Step 3: Mount on the feed page**

In `apps/web/app/(authed)/page.tsx`: import `getOnboardingState` and `OnboardingChecklist`, fetch state, render `<OnboardingChecklist state={onboarding} />` just under the `<h1>`. (The inline `<PasteForm>` block is removed in Task 16 — leave it for now; the two changes commit separately.)

- [ ] **Step 4: Verify + manual**

Run: `pnpm --filter @benkyou/web typecheck && pnpm check:i18n`
Manual: fresh bootstrap (no AI, no source) → checklist shows 3 incomplete steps deep-linking to settings/sources; configure AI → step ① flips done on refresh; add a source → step ② done; first item reaches `done` → step ③ done and the whole card disappears; "hide for now" hides it but it returns on next visit while incomplete.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/OnboardingChecklist.tsx apps/web/app/(authed)/page.tsx apps/web/messages/
git commit -m "feat(web): in-app 3-step onboarding checklist (real-state derived)"
```

---

### Task 14: AI-readiness capability gates (paste / fetch-now / search / empty states)

**Files:**
- Modify: `apps/web/app/api/items/paste/route.ts`
- Modify: `apps/web/app/(authed)/sources/actions.ts` (`fetchSourceNowAction`)
- Modify: `apps/web/app/(authed)/search/page.tsx`
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`
- Test: `apps/web/app/api/items/paste/route.test.ts` (or extend an existing route test if present)

🔧 logic-bearing — gate the pipeline-triggering actions so a not-`aiConfigured` user never sees fake failures (spec §4.4). Calm disabled state + "configure AI first" pointer.

**Interfaces:**
- Consumes: `getUserSettings`, `isAiConfigured` (Task 3).
- Produces: paste route returns `409 { error: 'ai_not_configured' }` when not configured; `fetchSourceNowAction` no-ops when not configured; search page renders a calm "configure AI" notice instead of the search box.

- [ ] **Step 1: Write the failing test for the paste gate**

```ts
// apps/web/app/api/items/paste/route.test.ts
import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@benkyou/core/settings', () => ({
  getUserSettings: vi.fn(),
  isAiConfigured: (s: { llmProvider?: string }) => Boolean(s?.llmProvider),
}));
vi.mock('@benkyou/core/items', () => ({ pasteUrl: vi.fn(async () => ({ created: 'id-1' })) }));
vi.mock('@/lib/auth', () => ({ requireApiAuth: vi.fn(async () => null) }));

import { POST } from './route';
import { getUserSettings } from '@benkyou/core/settings';

describe('POST /api/items/paste readiness gate', () => {
  beforeEach(() => vi.clearAllMocks());

  test('returns 409 ai_not_configured when AI unconfigured', async () => {
    vi.mocked(getUserSettings).mockResolvedValue({ llmProvider: null } as never);
    const res = await POST(new Request('http://x/api/items/paste', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://e.com' }),
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'ai_not_configured' });
  });

  test('proceeds when AI configured', async () => {
    vi.mocked(getUserSettings).mockResolvedValue({ llmProvider: 'openai' } as never);
    const res = await POST(new Request('http://x/api/items/paste', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://e.com' }),
    }));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter @benkyou/web exec vitest run app/api/items/paste/route.test.ts`
Expected: FAIL — no gate yet (returns 200 both times).

- [ ] **Step 3: Gate the paste route**

```ts
// apps/web/app/api/items/paste/route.ts
import { z } from 'zod';
import { pasteUrl } from '@benkyou/core/items';
import { getUserSettings, isAiConfigured } from '@benkyou/core/settings';
import { requireApiAuth } from '@/lib/auth';

const schema = z.object({ url: z.string().url() });

export async function POST(req: Request): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;

  const settings = await getUserSettings();
  if (!settings || !isAiConfigured(settings)) {
    // Don't let an item run into `failed` before AI is configured (spec §4.4).
    return Response.json({ error: 'ai_not_configured' }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'invalid url' }, { status: 400 });
  }
  const result = await pasteUrl(parsed.data.url);
  return Response.json(result);
}
```

- [ ] **Step 4: Gate `fetchSourceNowAction` + search page**

In `sources/actions.ts` `fetchSourceNowAction`, after auth + id parse:

```ts
const settings = await getUserSettings();
if (!settings || !isAiConfigured(settings)) return; // calm no-op; UI shows the disabled hint
```

In `search/page.tsx`, fetch settings; if not `aiConfigured`, render a calm notice (`text-muted`) with a link to `/settings` instead of the search UI. Add i18n keys `search.aiRequired` (zh: "先完成 AI 配置后即可搜索 →", en: "Configure AI to enable search →").

- [ ] **Step 5: Surface the disabled state to the paste UI**

The `PasteModal` (Task 16) reads an `aiConfigured` prop and, when false, renders a disabled input + the calm hint (i18n `paste.aiRequired`). Add keys now: zh `"aiRequired": "先完成 AI 配置 →"`, en `"aiRequired": "Configure AI first →"` under `paste`. (Wiring is Task 16; the keys land here so check:i18n stays green and the gate story is complete.)

- [ ] **Step 6: Run tests + i18n**

Run: `pnpm --filter @benkyou/web exec vitest run app/api/items/paste/route.test.ts && pnpm check:i18n && pnpm --filter @benkyou/web typecheck`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/items/paste/ apps/web/app/(authed)/sources/actions.ts apps/web/app/(authed)/search/page.tsx apps/web/messages/
git commit -m "feat(web): AI-readiness capability gates (paste/fetch/search) with calm hints"
```

---

### Task 15: Password-only `/setup` + `/login` retoken

**Files:**
- Modify: `apps/web/app/setup/SetupForm.tsx`
- Modify: `apps/web/app/setup/actions.ts`
- Modify: `apps/web/app/setup/actions.test.ts`
- Modify: `apps/web/app/login/LoginForm.tsx`
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`

🔧 + token cleanup (spec §4.5 / §8). The first-run link is reduced to: choose locale → bootstrap (password from `INITIAL_PASSWORD`) → land in app shell + onboarding.

**Interfaces:**
- Consumes: slimmed `completeSetup` (Task 6); `createSession`; `env.INITIAL_PASSWORD`.
- Produces: a `setupAction` that bootstraps with `{ password: env.INITIAL_PASSWORD, locale }`, creates a session, redirects to `/`. No provider/source collection, no connectivity test.

- [ ] **Step 1: Rewrite `setup/actions.ts`**

```ts
// apps/web/app/setup/actions.ts
'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { env } from '@benkyou/core/config';
import { createSession } from '@benkyou/core/auth';
import { completeSetup, isInitialized } from '@benkyou/core/setup';
import { SESSION_COOKIE } from '@/lib/session-cookie';

export interface SetupState {
  error?: string;
  values?: { locale: string };
}

const Schema = z.object({ locale: z.enum(['zh', 'en']) });

export async function setupAction(_prev: SetupState, fd: FormData): Promise<SetupState> {
  if (!env.INITIAL_PASSWORD) return { error: 'needInitialPassword' };
  if (await isInitialized()) redirect('/login');

  const parsed = Schema.safeParse({ locale: fd.get('locale') });
  if (!parsed.success) return { error: 'invalid', values: { locale: String(fd.get('locale') ?? 'zh') } };

  const setup = await completeSetup({ password: env.INITIAL_PASSWORD, locale: parsed.data.locale });
  if (!setup.inserted) redirect('/login');

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
  redirect('/'); // lands in app shell + onboarding (spec §4.1)
}
```

- [ ] **Step 2: Rewrite `SetupForm.tsx` (locale-only, tokens)**

```tsx
// apps/web/app/setup/SetupForm.tsx
'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { setupAction, type SetupState } from './actions';

export function SetupForm() {
  const t = useTranslations('setup');
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});
  const errorText = state.error ? t(state.error as 'needInitialPassword') : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm text-ink">{t('locale')}</span>
        <select name="locale" defaultValue={state.values?.locale ?? 'zh'} className="rounded-md border border-line bg-surface p-2 text-ink">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>
      {errorText ? <p className="text-sm text-err">{errorText}</p> : null}
      <button type="submit" disabled={pending} className="rounded-md bg-accent-vivid p-2 text-bg disabled:opacity-50">
        {t('submit')}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Trim setup i18n + copy**

In both message files, the `setup` namespace can drop the provider/embed/source keys (or leave them — `check:i18n` only requires parity, not minimalism; **leaving them is lower-risk**). Update `setup.submit` copy to "开始使用 Benkyou" / "Start using Benkyou" and ensure `setup.title` + `setup.locale` + `setup.needInitialPassword` exist in both. Keep keys parity-consistent.

- [ ] **Step 4: Update `setup/actions.test.ts`**

Read it; it likely posts the full provider/source form. Rewrite the cases to: (a) missing `INITIAL_PASSWORD` → `{ error: 'needInitialPassword' }`; (b) valid locale → `completeSetup` called with `{ password, locale }` and a session cookie set / redirect to `/`. Mock `completeSetup`, `isInitialized`, `createSession`, `cookies`, `headers` as the existing test already does — preserve its mocking style.

- [ ] **Step 5: Retoken `LoginForm.tsx`**

Replace `slate-*`/`red-600` classes with tokens: input `rounded-md border border-line bg-surface p-2 text-ink`; error `text-sm text-err`; submit `rounded-md bg-accent-vivid p-2 text-bg disabled:opacity-50`.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @benkyou/web exec vitest run app/setup/actions.test.ts && pnpm --filter @benkyou/web typecheck && pnpm check:i18n`
Manual: with a fresh DB + `INITIAL_PASSWORD` set, hit `/setup` → choose language → land on `/` with the onboarding checklist; `/login` and `/setup` are visually consistent with the platform (no slate/red).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/setup/ apps/web/app/login/LoginForm.tsx apps/web/messages/
git commit -m "feat(web): password-only /setup bootstrap; retoken setup+login to semantic tokens"
```

---

# Phase F — Global paste + Cmd+K palette

### Task 16: `PasteModal` + Cmd+K command palette; remove inline paste; top-bar entry

**Files:**
- Create: `apps/web/components/PasteModal.tsx`
- Create: `apps/web/components/CommandPalette.tsx`
- Modify: `apps/web/components/shell/AppShell.tsx`
- Modify: `apps/web/components/shell/useShellState.ts`
- Modify: `apps/web/app/(authed)/layout.tsx` (pass `aiConfigured` into the shell)
- Modify: `apps/web/app/(authed)/page.tsx` (remove inline `<PasteForm>`)
- Modify: `apps/web/app/(authed)/sources/AdhocCard.tsx` (paste shortcut button opens the modal)
- Delete: `apps/web/app/(authed)/items/PasteForm.tsx` (logic folded into `PasteModal`)
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`

🎨 net-new (command palette + modal). Build from tokens; mark `{/* DESIGN-GAP */}` for palette/modal chrome the kit doesn't yet specify. This replaces the right-bottom-float decision (spec §2.3): right-bottom stays reserved for the Agent ball (§8.4).

**Interfaces:**
- Consumes: `pasteUrl` via the existing `/api/items/paste` POST (now gated, Task 14); `aiConfigured` boolean from the layout.
- Produces: an event-based open mechanism so any surface can open paste/palette without prop-drilling. Use a tiny module: `apps/web/components/shell/commands.ts` exporting `openPaste()` / `openPalette()` that dispatch `window` CustomEvents (`'bk:open-paste'`, `'bk:open-palette'`); `PasteModal`/`CommandPalette` listen for them. This keeps the shell logic-free and lets the `/sources` server component trigger paste via a small client button.

- [ ] **Step 1: Add the command event module**

```ts
// apps/web/components/shell/commands.ts
'use client';

export const PASTE_EVENT = 'bk:open-paste';
export const PALETTE_EVENT = 'bk:open-palette';

export function openPaste(): void {
  window.dispatchEvent(new CustomEvent(PASTE_EVENT));
}
export function openPalette(): void {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}
```

- [ ] **Step 2: Replace the Cmd+K shortcut**

In `useShellState.ts`, replace `useGlobalSearchShortcut` with `useCommandPaletteShortcut` that dispatches `PALETTE_EVENT` on Cmd/Ctrl-K:

```ts
import { PALETTE_EVENT } from './commands';

export function useCommandPaletteShortcut(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
```

(Drop the now-unused `useRouter` import there if nothing else uses it.)

- [ ] **Step 3: Write `PasteModal`**

A `<dialog>`-based client modal (mirror `MobileDrawer`'s `showModal()` pattern in AppShell). Opens on `PASTE_EVENT`. Contains the paste logic moved from `PasteForm` (POST `/api/items/paste`, then `router.push('/items/[id]')`). When `aiConfigured` is false, render the input disabled + `paste.aiRequired` hint linking to `/settings`. On a `409 ai_not_configured` response, show the same hint. Token-styled; `{/* DESIGN-GAP: modal chrome */}` for any unspecified surface treatment.

```tsx
// apps/web/components/PasteModal.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import { PASTE_EVENT } from './shell/commands';

export function PasteModal({ aiConfigured }: { aiConfigured: boolean }) {
  const t = useTranslations('paste');
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const open = (): void => ref.current?.showModal();
    window.addEventListener(PASTE_EVENT, open);
    return () => window.removeEventListener(PASTE_EVENT, open);
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
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
    const data = (await res.json()) as { created?: string; existing?: string };
    const id = data.created ?? data.existing;
    ref.current?.close();
    if (id) router.push(`/items/${id}` as Route);
  }

  return (
    // DESIGN-GAP: modal chrome — neutral centered dialog for now.
    <dialog ref={ref} className="m-auto w-full max-w-md rounded-md bg-surface p-5 text-ink backdrop:bg-ink/25">
      <h2 className="mb-3 font-serif text-lg font-semibold">{t('title')}</h2>
      {aiConfigured ? (
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
            <button type="submit" className="rounded-md bg-accent-vivid px-3 py-1.5 text-sm text-bg">
              {t('submit')}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted">{t('aiRequired')}</p>
      )}
    </dialog>
  );
}
```

Add i18n: `paste.cancel` (zh "取消" / en "Cancel"). (`paste.aiRequired` added in Task 14.)

- [ ] **Step 4: Write `CommandPalette`**

A `<dialog>` palette opening on `PALETTE_EVENT`. Actions: search (push `/search`), paste URL (dispatch `PASTE_EVENT` after closing), jump to feed/sources/settings. Keep it minimal — a static list (no fuzzy filter needed for v1; a text input that filters the static list by label substring is enough). Token-styled, `{/* DESIGN-GAP: palette chrome */}`. New i18n namespace `palette`:

zh: `{ "title": "命令", "search": "搜索", "paste": "粘贴 URL", "feed": "动态", "sources": "源", "settings": "设置", "placeholder": "输入命令…" }`
en: `{ "title": "Commands", "search": "Search", "paste": "Paste URL", "feed": "Feed", "sources": "Sources", "settings": "Settings", "placeholder": "Type a command…" }`

- [ ] **Step 5: Mount in AppShell + add top-bar paste button**

In `AppShell.tsx`: import `PasteModal`, `CommandPalette`, `openPaste`, `useCommandPaletteShortcut`; accept a new prop `aiConfigured: boolean`. Call `useCommandPaletteShortcut()` (replacing `useGlobalSearchShortcut()`). In the header's right-side button group, add a paste button (`onClick={openPaste}`, ghost-icon style, `aria-label={t('paste')}` — add `shell.paste` key zh "粘贴" / en "Paste"). At the end of the shell tree, render `<PasteModal aiConfigured={aiConfigured} />` and `<CommandPalette />`. The NavList's `⌘K` hint next to search can stay (Cmd+K now opens the palette which includes search — acceptable; optionally move the hint to its own palette affordance, but not required).

- [ ] **Step 6: Pass `aiConfigured` from the layout**

In `(authed)/layout.tsx`: fetch `getUserSettings()` + compute `isAiConfigured`, pass `aiConfigured` to `<AppShell>`.

- [ ] **Step 7: Remove inline paste from the feed**

In `(authed)/page.tsx`: remove the `import { PasteForm }` and the `<div className="mt-4 mb-2"><PasteForm /></div>` block. Delete `apps/web/app/(authed)/items/PasteForm.tsx`. Update the feed empty-state copy if it referenced the inline form.

- [ ] **Step 8: Wire the adhoc card paste shortcut**

`AdhocCard` is a server component; add a tiny client button `PasteShortcut` (`'use client'`, `onClick={openPaste}`) and render it in the card. New: `apps/web/app/(authed)/sources/PasteShortcut.tsx`. Uses `sources.pasteUrl` label (added in Task 10).

- [ ] **Step 9: Verify + manual**

Run: `pnpm --filter @benkyou/web typecheck && pnpm check:i18n`
Manual: Cmd+K opens the palette; "paste URL" action and the top-bar button and the adhoc-card shortcut all open the same modal; with AI unconfigured the modal shows the calm "configure AI" hint and submitting is blocked; with AI configured, pasting routes to the processing view; the right-bottom corner has NO paste float (reserved for Agent). Feed no longer shows an inline paste form.

- [ ] **Step 10: Commit**

```bash
git add apps/web/components/PasteModal.tsx apps/web/components/CommandPalette.tsx apps/web/components/shell/ apps/web/app/(authed)/layout.tsx apps/web/app/(authed)/page.tsx apps/web/app/(authed)/sources/ apps/web/messages/
git rm apps/web/app/(authed)/items/PasteForm.tsx
git commit -m "feat(web): global paste modal + Cmd+K command palette; remove inline paste"
```

---

# Phase G — Whole-suite verification

### Task 17: Full check sweep + spec back-annotation note

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-benkyou-design.md` (back-annotations) — only if the user accepts the proposal (spec §0 prerequisite).

- [ ] **Step 1: Run the full CI gate**

Run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm test
```

Expected: all green. Investigate any failure with systematic-debugging before proceeding — do not paper over.

- [ ] **Step 2: Mechanical token guard (manual grep until lint rule exists)**

Run a grep over touched surfaces for forbidden raw values:

```bash
grep -rnE "#[0-9a-fA-F]{3,6}|[a-z-]+-\[|style=\{\{" apps/web/app/setup apps/web/app/login apps/web/app/\(authed\)/sources apps/web/app/\(authed\)/settings apps/web/components/PipelineStepper.tsx apps/web/components/PasteModal.tsx apps/web/components/CommandPalette.tsx apps/web/components/OnboardingChecklist.tsx
```

Expected: no matches (DESIGN.md §6 guard). Fix any hit by routing through a token.

- [ ] **Step 3: DESIGN-GAP inventory for the impeccable polish pass**

Run:

```bash
grep -rn "DESIGN-GAP" apps/web/
```

Confirm each net-new surface that lacks a kit primitive (onboarding card, paste modal, command palette, planned-type blocks, source-type add disclosure) carries a marker. These are the handoff targets for the impeccable polish pass (spec §9.2 / CLAUDE.md workflow) — done **before** requesting-code-review.

- [ ] **Step 4: Note the spec divergences to back-annotate**

Prepare a short note for the user (do not edit the main spec until they accept the proposal — spec §0). The divergences from the proposal text to record:
- No `/api/items/[id]/status` route was added; progress uses RSC refresh + `getItemProgress` (already carries `current_stage`). Spec §3.3/§7.3 wording assumed a JSON endpoint.
- `/setup` kept as a slimmed password-only bootstrap (decision locked at planning).
- Cmd+K now opens a command palette (search + paste + nav) rather than navigating straight to search.
- Draft sources: added while not `aiConfigured` are stored `enabled=false` and are NOT auto-enabled on transition to `aiConfigured` (open-question §11.5 resolved as "manual enable" — the source row shows an enable button; no silent auto-enable).
- Planned-type placeholders are shown now (collapsed/disabled), resolving open-question §11.6 toward "show now" to prevent the RSS-manager misread.

- [ ] **Step 5: Commit (note only; spec edits gated on acceptance)**

```bash
git add docs/superpowers/plans/2026-06-18-benkyou-ux-legibility.md
git commit -m "docs: UX legibility implementation plan"
```

---

## Self-Review (performed against the spec)

**Spec coverage:**
- §2 source IA → Tasks 4, 10, 11 (registry-driven blocks, planned placeholders, adhoc card, overview bar, no schema change).
- §2.3 global paste / right-bottom conflict → Task 16 (top-bar + Cmd+K palette + sources shortcut; no float; inline form removed).
- §3.1 single-point vocabulary + pinned `mapStep` signature → Task 1.
- §3.2 calm failure semantics → Tasks 8, 9 (err dot + error line + retry; reuse `retryItemAction`).
- §3.3 single-item stepper + `current_stage` payload → Task 8 (RSC path; divergence noted).
- §3.4 single-source compact status + expand → Tasks 2, 9, 11.
- §3.5 global scope unchanged → respected (PipelineHealthBanner / admin/jobs untouched).
- §4 onboarding (in-app, readiness gates, bootstrap split, empty-as-guide) → Tasks 6, 7, 13, 14, 15.
- §4.5 / §8 token debt → folded into Tasks 11, 12, 15 (sources/settings/setup/login retoken).
- §5 settings IA, exposure+explanation, ranking presets/advanced → Tasks 5, 11 (per-source weight/poll), 12.
- §6 page IA roll-up → Tasks 11, 12, 8, 16, 13.
- §9 phasing → this plan is the functional-first pass (🔧-led); impeccable polish (§9.2) and M5 (§9.3) are out of scope.
- §10 invariants → enforced in Global Constraints; verified in Task 17.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — every code step shows code; every action/component has its body.

**Type consistency:** `mapStep(state, currentStage, transcriptStatus, lastError)` identical across Tasks 1/2/8/9. `SourcePipelineStatus` (core type) aliased to `SourcePipelineStatusData` where it collides with the component of the same name (Tasks 9, 10, 11). `createSource`/`updateSource` extended signatures used consistently in Task 11's action. `isAiConfigured`/`aiReadiness` signature (`Pick<...>`) consistent across Tasks 3/7/14/16.

**Known cross-task coupling to flag for executor:** Tasks 10 and 12 both reference `AdhocWeightForm` / `updateAdhocWeightAction`; execute Task 12's action step (or its stub) before typechecking Task 10's page wiring. The plan calls this out inline.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-18-benkyou-ux-legibility.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
