# M2a Design — Subtitle Sources + URL Paste

Date: 2026-06-14. Brainstorm output for the **M2a** slice of M2 (source expansion).
Supersedes `docs/superpowers/reviews/2026-06-14-m2-readiness-review.md` for the M2a portion;
delete the review doc after the M2a *and* M2b plans land.

The authoritative design remains `docs/superpowers/specs/2026-05-27-benkyou-design.md`
(referenced below as "spec §X"). This doc records only the **M2-specific decisions** the
brainstorm locked and the **spec deltas** they imply — it does not restate the spec.

---

## Decision: split M2 into M2a / M2b

M2 (spec §15) bundled subtitle sources, URL paste, no-subtitle transcription, the failure
banner, and a foundation phase. Only **no-subtitle transcription** requires surgery on the
core state machine (the runner's deferred-advancement seam, spec §6.2 line 471). Subtitle-based
video sources go through the existing synchronous `extract → extracted` path and need none of it.

Splitting isolates the state-machine change to **M2b**, where the `transcribe` sub-task is its
sole consumer and validation — which is exactly what the readiness review wanted ("do the runner
seam with the transcribe path as its validation; don't geardown the core state machine with no
consumer"). M2a therefore ships visible value (the majority of YouTube/Bilibili content is
subtitled) **without touching `runner.ts` or the state machine at all**.

- **M2a** = this doc.
- **M2b** = no-subtitle transcription. Gets its own brainstorm. Carries the three review-listed
  open decisions: runner deferred-advancement seam shape, transcribe retry-counter home, and how
  `transcribe-policy.ts` expresses the `skipped_serverless` boundary. Not decided here.

---

## M2a scope

**In:**
1. `SourceAdapter.extract()` refactor — `extract` stage becomes a pure dispatcher.
2. YouTube + Bilibili subtitle adapters.
3. URL paste flow (article + subtitled video): duplicate-URL jump, stage-level progress.
4. `transcript_status` badges.
5. Pipeline-health failure banner (holistic).
6. Two migrations: `search_vec` truncation, `sources.consecutive_failures`.

**Out (→ M2b):** no-subtitle transcription (Whisper chunked + diarization), runner
deferred-advancement seam, `transcribe` queue wiring (both dispatchers + status panel),
`transcribe-policy.ts` transcribe/confirm/serverless branches, `ai_usage` extension migration
(`conversation_id`/`duration_seconds`/`kind='transcription'`) + usage-instrumentation
consolidation into `core/ai`, and the paste flow's "confirm transcription / estimated duration"
sub-flow.

**Hard boundary:** M2a does not import or modify `queue/runner.ts` or `pipeline/state.ts`'s
advancement logic. Subtitled video flows synchronously like an article.

**No-subtitle video — M2a temporary behavior:** a video whose subtitles are absent (or require
login on Bilibili) gets `transcript_status='unavailable'` and **continues the pipeline** on
`title + metadata` (embed/score, per spec §6.2 "继续 embed/score 用 title"). When M2b lands, new
no-subtitle videos route to `transcribe` instead; M2a-era `unavailable` items are **not**
backfilled (consistent with spec §6.4 "改设置/能力不回填存量").

---

## 1. `SourceAdapter.extract()` refactor

Today `extract` is a god function: Readability and `contentType:'article'` are hardcoded in
`pipeline/extract.ts:37-49`, and `SourceAdapter` (`sources/types.ts:10-13`) only has
`fetchItems()`. Spec §4.1/§6.2 require `extract(item)` on the adapter so each new source lives
behind the interface instead of piling into the stage.

```ts
type TranscriptStatus =
  | 'na' | 'pending' | 'present'
  | 'skipped_too_long' | 'skipped_serverless' | 'unavailable';

// timed transcript contract (see §6 deltas + video-article-design.md): subtitles/Whisper
// emit timed segments; speaker is optional (only when the platform/endpoint provides it).
interface TranscriptSegment { start: number; end: number; text: string; speaker?: string }

interface ExtractInput {
  url: string;
  rawContent: string | null;
  externalId: string | null;
  // config from the owning source row when source_id is set; absent for adhoc.
  config?: Record<string, unknown>;
}

interface ExtractResult {
  rawContent: string | null;
  contentType: 'article' | 'video' | 'discussion' | 'paper';
  transcriptStatus?: TranscriptStatus; // video adapters set this; default 'na'
  transcriptSegments?: TranscriptSegment[] | null; // timed cues → items.transcript_segments
  videoDuration?: number | null;
  videoKind?: string | null;           // M2a leaves default; M3 score branch classifies
}

interface SourceAdapter {
  readonly type: string;
  fetchItems(config: Record<string, unknown>): Promise<RawItem[]>;
  extract(input: ExtractInput): Promise<ExtractResult>; // NEW
}
```

- `pipeline/extract.ts` becomes a pure dispatcher: `resolveAdapter(item) → adapter.extract(input)
  → write columns` (incl. `transcript_segments`). The current Readability path moves into the
  article/RSS adapter's `extract()`.
- **Adapter resolution:** auto source (`source_id` set) → by `source.type`. Adhoc paste
  (`source_id IS NULL`) → detect by URL host (`youtube.com`/`youtu.be` → youtube;
  `bilibili.com` → bilibili; else → article).

This refactor is the only structural change M2a makes to the pipeline, and it is additive to the
adapter interface — no state-machine change.

## 2. Subtitle adapters + degradation contract

- YouTube / Bilibili `extract()`: fetch subtitles → present →
  `{ rawContent: subtitle, transcriptSegments: cues, contentType: 'video',
  transcriptStatus: 'present', videoDuration }` — where `cues` are the timed subtitle cues mapped
  to `[{ start, end, text, speaker? }]` (`speaker` only if the platform provides it); absent (or
  Bilibili login-required) →
  `{ rawContent: null, transcriptSegments: null, contentType: 'video',
  transcriptStatus: 'unavailable', videoDuration }`, pipeline continues.
- **Timed transcript contract:** subtitles already carry per-cue timing, so the adapter populates
  `transcript_segments` (not only the flattened `rawContent`). Required by the video→article
  feature for jump-links / speech-density; it **redefines** `transcript_segments` semantics (see
  §6 deltas). M2b's Whisper path must do the same (always timed; speaker only when diarized).
- **Degradation contract:** any subtitle-fetch exception is caught and mapped to `'unavailable'`
  + continue. An adapter **never throws to fail the item** — scrape sources are fragile and a
  missing/blocked subtitle is normal, not a pipeline error. (Contrast: a genuine transient like a
  network 5xx may still throw to let pg-boss retry; a definitive "no captions" resolves to
  `unavailable` immediately.)
- **Bilibili scope:** login-free subtitles only (public/CC). No credentials stored anywhere.
  wbi signing is done per-request; videos whose captions require a session cookie degrade to
  `unavailable`. Full cookie support is explicitly out of scope (fragile, credential storage,
  expiry maintenance).
- **Fragility note:** both YouTube (timedtext/innertube, PoToken churn) and Bilibili subtitle
  endpoints are scrape-fragile. The degradation contract is what keeps that fragility from
  turning into failed items; the library/endpoint choice is a writing-plans concern.

## 3. URL paste flow

- `POST /api/items/paste { url }` (thin route → `@benkyou/core`):
  compute `url_hash` → **hit** → `{ existing: id }` (frontend navigates to `/items/[id]`);
  **miss** → insert `pending` item (`source_id = NULL`) + enqueue `extract` → `{ created: id }`.
  The `items.url_hash` unique constraint is the dedup anchor (spec §5.3).
- **Stage-level progress:** reuse the M1c `AutoRefresh` polling pattern to show the new item
  advancing `pending → … → done` (or its `current_stage` + `last_error` on failure).
- M2a covers paste of articles and subtitled videos. A pasted no-subtitle video follows the M2a
  temporary behavior (`unavailable` + continue); the "confirm transcription / estimated duration"
  sub-flow is M2b.

## 4. Pipeline-health failure banner (holistic)

- New lightweight aggregate `getPipelineHealth()` → `{ failingSources, failedItems, orphans }`.
  `failedItems`/`orphans` reuse the M1c `pipeline/status.ts` counting queries (count-only, not
  the full panel payload); `failingSources` = sources with `consecutive_failures ≥ threshold`.
- A global banner on the authed layout: any signal `> 0` → one prioritized line + link
  (sources → `/sources`; failed/orphans → `/admin/jobs`). It is the attention-grabber for a
  silently-broken pipeline, distinct from the detailed `/admin/jobs` panel.
- **🎨 routing:** `DESIGN.md` has no banner/alert primitive (only principle-level mentions of
  "状态横幅/错误横幅"). The functional pass builds a **structurally-neutral shell** marked
  `{/* DESIGN-GAP: alert/banner */}`; the impeccable polish pass adds tokens/styling. Per the
  superpowers×impeccable workflow, do the polish pass before requesting code review.

## 5. Migrations (2) + wiring

1. **`search_vec` truncation** — change the generated column to
   `left(coalesce(raw_content,''), 100000)` (spec §5.3 ⚠️). A multi-hour subtitle can overflow
   the tsvector ~1MB cap → deterministic INSERT/UPDATE failure → that item permanently fails.
   This is required in M2a because long *subtitles* already trigger it (not just M2b transcripts).
   PG cannot `ALTER` a generated expression in place → DROP COLUMN + ADD COLUMN, which also drops
   the GIN index → recreate it. **drizzle-kit may miss this — hand-review the generated SQL.**
2. **`sources.consecutive_failures`** `int not null default 0` (spec §5.3 line 246). Wiring is at
   the two existing `lastFetchError` sites in `pipeline/ingest.ts`: on failure (`ingest.ts:30`,
   alongside writing `lastFetchError`) → `consecutive_failures + 1`; on success (`ingest.ts:61`,
   alongside clearing `lastFetchError`) → reset to `0`. Feeds the banner's `failingSources` signal.

The `ai_usage` extension migration is **deferred to M2b** (its consumers — transcription metering
and M4 agent attribution — don't exist in M2a; M2a adds no AI call sites). Do not add columns
with no consumer.

## 6. Spec deltas to land

- **§15:** split the M2 row into **M2a** and **M2b** (done in this branch).
- **§6.2:** note Bilibili's M2a scope (login-free subtitles) and the "fetch failure →
  `unavailable` + continue, never fail the item" degradation contract.
- **§5.3 + §6.2 (`transcript_segments` semantics):** redefine `transcript_segments` from
  「视频说话人分段(如果可用)」(§5.3 line 266) to **「timed transcript segments
  `[{ start, end, text, speaker? }]`; speaker optional」**, and amend §6.2's transcribe note (line
  469, "only when speaker labels") so M2b **always** writes timed segments (speaker only when
  diarized). Driven by the video→article timed-transcript contract; M2a's subtitle adapters are the
  first writer.
- **Milestone-sequencing note:** M2a's no-subtitle video → temporary `unavailable`; M2b routes it
  to `transcribe`. No backfill of M2a-era items.

(§6.2's transcribe sub-task design, the runner state-ownership rationale, the `ai_usage`/serverless
boundary, and the embedding-dimension invariant are all unchanged and remain authoritative for M2b.)

## 7. Testing (TDD targets)

- Adapter dispatch routing: by `source.type` for auto sources, by URL host for adhoc.
- Subtitle adapter: present → `present` + rawContent **+ timed `transcript_segments`** (cues mapped
  to `{start,end,text,speaker?}`); absent → `unavailable` + continue (segments null); exception →
  `unavailable` (never throws to fail the item).
- Paste: duplicate URL → `existing`; new URL → `created` + enqueued.
- `consecutive_failures`: increments on fetch failure, resets on success.
- `getPipelineHealth()` aggregation across the three signals.
- `search_vec` truncation: an over-cap `raw_content` no longer errors on INSERT/UPDATE.
- e2e: paste an article → progress → done; paste a duplicate URL → jump to existing item.
