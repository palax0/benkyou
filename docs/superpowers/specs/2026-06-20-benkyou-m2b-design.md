# M2b Design — No-Subtitle Transcription

Date: 2026-06-20. Brainstorm output for the **M2b** slice of M2 (no-subtitle video/audio
transcription). With this doc the M2a/M2b split is fully specced; delete
`docs/superpowers/reviews/2026-06-14-m2-readiness-review.md` once the M2b plan lands.

Authoritative design remains `docs/superpowers/specs/2026-05-27-benkyou-design.md`
(referenced as "spec §X"). This doc records only the **M2b decisions** the brainstorm locked
and the **spec deltas** they imply — it does not restate the spec.

> **Implementation ordering (binding on the plan).** The M2b implementation plan's **Task 0**
> is "land the canonical spec deltas" (§10 list B). It must run **before any code task** — we do
> not enter implementation with the main spec still contradicting this doc (e.g. main spec §6.2
> line 460 still says over-limit paste is rejected synchronously). No scattered main-spec edits
> happen now; they all land as Task 0.

---

## Decision log (brainstorm forks → choices)

| # | Fork | Choice | Why |
|---|------|--------|-----|
| 1 | Audio acquisition scope | **Narrow inputs, engine-first** | Prove the novel deferred-advancement state-machine seam against easy audio; defer fragile `yt-dlp` + the credential problem (gated platform audio needs the same PoToken/SESSDATA we deferred past M2b). |
| 2 | Narrow input set | **Direct-media URL paste + podcast RSS `<enclosure>`** | Paste carries the confirm sub-flow (required); podcast enclosure is a zero-credential, stable, direct audio URL that exercises the **auto worker path** end-to-end on real recurring data. No file upload, no platform download. |
| 3 | Runner seam shape | **`transcribe` = own queue (not in `PER_ITEM_STAGES`) + generic `StageOutcome.advance`** | The at-least-once guard (§6.1) must stay hole-free. Inlining into `extract` is forbidden (would balloon every extract job's timeout + conflate retry counters, §6.2); a `PER_ITEM_STAGES` member needs a guard exception (spec forbids). |
| 4 | Transcribe retry/terminal | **Hardcoded `retryLimit=2`; own dead-letter → `unavailable` + continue (not `failed`)** | Each retry re-downloads + re-chunks + re-calls Whisper (no chunk resume in v1) — burns $/bandwidth. 2 = one retry to absorb transient Whisper 5xx/rate-limit, then degrade. pg-boss owns the count; `items.attempts` untouched, no new column. |
| 5 | "Awaiting confirmation" modeling | **New `transcript_status='needs_confirmation'`; async confirm in detail view** | The "skip-then-re-transcribe" alternative is spec-forbidden (re-flow after `done` hits the guard, §6.2). Over-`manual_limit` paste reuses `skipped_too_long`+continue instead of a synchronous reject (keeps ffmpeg worker-only). |
| 6 | Transcribe job timeout | **Per-job `expireInSeconds = ceil(durationSec × factor) + overhead`, set at enqueue** | `video_manual_limit` is **audio length**, not wall-clock. `expireInSeconds = manualLimit` lets a slow-but-fine job (download + ffmpeg + rate-limited Whisper) outrun its own expiry → pg-boss re-delivers an *active* job → a second Whisper run bills again. The budget must track processing wall-time, per job. |
| 7 | `current_stage` during transcribe/confirm | **Stays `'extract'`; advance writes `'embed'`** | `retryItem` only accepts `PER_ITEM_STAGES` (retry.ts) and `mapStep` derives the user step from `current_stage`. Keeping `'extract'` makes admin retry re-run extract (→ re-handoff, recoverable) **and** lets the existing panel mapper emit the `transcribing`/`awaiting confirmation` sub-step for free. Writing `'transcribe'` breaks both. |

---

## M2b scope

**In:**
1. Runner **deferred-advancement seam** — generic `StageOutcome.advance` (no transcribe-named guard hole).
2. `transcribe` queue + `runTranscribe` + transcribe-specific dead-letter, wired into **both** dispatchers.
3. `transcribe-policy.ts` — pure decision function (`transcribe` / `confirm` / `skipped_too_long` / `skipped_serverless`).
4. **Transcribe engine** — download → ffmpeg chunk → concurrent Whisper → timestamp merge → timed `transcript_segments`.
5. **Narrow inputs** — direct-media URL paste; podcast RSS `<enclosure audio/*>` ingestion.
6. **Confirm sub-flow** (paste): `needs_confirmation` state + estimated-duration UI + confirm endpoint.
7. **ai_usage consolidation** (prerequisite) — move `recordUsage` into `core/ai` wrappers; extend for `kind='transcription'`.
8. **Panel/observability integration** — `transcribing` / `awaiting confirmation` user steps; transcription cost lane; orphan-detection exclusion; transcribe queue in queue-health.

**Out (deferred):** `yt-dlp` + YouTube/Bilibili audio download (needs the deferred per-platform
credential model); audio **file upload**; chunk-level resume (§11.2 远期); diarization beyond
endpoint-provided labels; backfill of M2a-era `unavailable` items (§6.4 不回填).

**Unchanged M2a behavior:** YouTube/Bilibili no-subtitle videos still degrade to
`transcript_status='unavailable'` + continue — M2b does **not** give them an audio path (no download
capability). Only direct-media + podcast-enclosure items reach `transcribe-policy`.

---

## 1. Runner deferred-advancement seam

The runner stays uniform; `extract` gains the ability to **hand off** without advancing.

```ts
// pipeline/state.ts — handlers may return a StageOutcome; default is advance.
export type StageOutcome = { advance: boolean };

// queue/runner.ts — runItemStage, after the handler:
const outcome = (await STAGE_HANDLERS[stage](itemId)) ?? { advance: true };
if (!outcome.advance) return;          // handler handed off; it owns the next advance
await completeStage(itemId, stage);
const next = NEXT_STAGE[stage];
if (next) await enqueueStage(boss, next, itemId);
```

- The top-of-runner at-least-once guard (`current !== STAGE_REQUIRED_STATE[stage] → return`) is
  **unchanged**. The seam adds no per-stage exception and names no `transcribe`.
- Only `extract` ever returns `{advance:false}` — when it enqueued `transcribe` or parked the item
  for confirmation. Every other handler returns `void` → normalized to `{advance:true}`.
- `extract` still runs `beginStage` first, so **extract-stage** transient failures (can't fetch
  metadata/probe duration) still consume `items.attempts` and dead-letter to `failed` normally.
  The retry-counter handoff to `transcribe` happens **only after extract succeeds**.
- **`current_stage` is left at `'extract'`** when `extract` returns `{advance:false}` (`completeStage`
  is skipped). This is deliberate (decision #7): it is the state that keeps `retryItem` and the panel
  mapper working — see §7-bis and §8.

### `extract` handoff branch (dispatcher)

After the adapter returns, for a transcribe-eligible media item (audio obtainable — direct-media or
podcast enclosure — and no usable transcript yet), `extract` resolves `durationSec` (**remote** ffprobe
for paste; `itunes:duration` for podcast — see §4) and calls `transcribePolicy`:

| Policy decision | `transcript_status` | Enqueue? | Outcome |
|---|---|---|---|
| `transcribe` | `pending` | `transcribe` (per-job expiry) | `{advance:false}` — stays `pending`, transcribe owns advance |
| `confirm` | `needs_confirmation` | — (parks) | `{advance:false}` — waits for user; **not** stuck |
| `skip` (`skipped_too_long` / `skipped_serverless`) | that value | — | `{advance:true}` — continue on title/metadata |

Articles, subtitled video, and YT/Bili-no-audio keep the M2a path → `{advance:true}`.

---

## 2. `transcribe` queue + runner + terminal

```ts
// queue/queues.ts
export const TRANSCRIBE_QUEUE = 'transcribe';
export const TRANSCRIBE_DEAD_LETTER = 'transcribe-failed';
export interface TranscribeJob { itemId: string }   // NOT a PerItemStage; no `stage` field

// registerQueues(): hardcoded policy (retryLimit independent of pipeline_max_attempts)
await boss.createQueue(TRANSCRIBE_DEAD_LETTER);
const policy = {
  retryLimit: 2, retryBackoff: true,
  deadLetter: TRANSCRIBE_DEAD_LETTER,
  // Generous backstop only; the real budget is set PER JOB at enqueue (below). A queue-wide
  // constant can't track per-item audio length, so it would always be sized for the worst case.
  expireInSeconds: TRANSCRIBE_EXPIRY_BACKSTOP_SEC,
};
await boss.createQueue(TRANSCRIBE_QUEUE, policy);
await boss.updateQueue(TRANSCRIBE_QUEUE, policy);
```

### Per-job expiry budget (decision #6)

`expireInSeconds` is a **processing wall-time budget**, not the audio length. `extract` (and the
confirm endpoint) know `durationSec` at enqueue time, so each transcribe job gets its own budget:

```ts
// queue/queues.ts — pure, tested
export const TRANSCRIBE_TIME_FACTOR = 2;            // covers download + ffmpeg + concurrent Whisper wall-time
export const TRANSCRIBE_FIXED_OVERHEAD_SEC = 900;   // connection setup, first-byte latency, ffmpeg spin-up
export function transcribeBudgetSec(durationSec: number): number {
  return Math.ceil(durationSec * TRANSCRIBE_TIME_FACTOR) + TRANSCRIBE_FIXED_OVERHEAD_SEC;
}

// enqueue (extract handoff AND confirm endpoint):
await enqueueTranscribe(boss, itemId, { expireInSeconds: transcribeBudgetSec(durationSec) });
```

The factor/overhead constants are tuning knobs; the plan may revise the numbers after a real
end-to-end run, but the **shape** (per-job, derived from `durationSec`, with a safety factor) is fixed.

> **Verify pg-boss 12 honors per-send `expireInSeconds`.** v12 moved much config to the queue
> policy; the plan must confirm `boss.send(..., { expireInSeconds })` overrides the queue default.
> If it does **not**, the documented fallback is the queue-wide constant sized for the worst case
> (`transcribeBudgetSec(video_manual_limit)`) — still a wall-time budget with a safety factor, never
> `= video_manual_limit`.

```ts
// queue/runner.ts
export async function runTranscribe(boss, { itemId }: TranscribeJob): Promise<void> {
  const item = await getTranscribeView(itemId);            // state, transcriptStatus, mediaUrl, url, durationSec
  if (item?.state !== 'pending' || item.transcriptStatus !== 'pending') return;  // own at-least-once guard
  try {
    const { segments, flatText, durationSec } = await transcribeItem(item);      // §5 engine
    await writeTranscript(itemId, { segments, flatText, durationSec, status: 'present' });
    await advanceAfterTranscribe(boss, itemId);            // pending→extracted, attempts=0, enqueue embed
  } catch (err) {
    await recordFailure(itemId, err);                      // last_error only
    throw;                                                 // retryLimit=2 → TRANSCRIBE_DEAD_LETTER
  }
}

// transcribe-specific terminal: degrade + CONTINUE (never markFailed)
export async function handleTranscribeDeadLetter(boss, { itemId }: TranscribeJob): Promise<void> {
  await setTranscriptStatus(itemId, 'unavailable');        // raw_content stays title-only
  await advanceAfterTranscribe(boss, itemId);              // pending→extracted, enqueue embed
}

// shared + guarded so double-delivery is safe (no-op once state has left pending)
async function advanceAfterTranscribe(boss, itemId): Promise<void> {
  // UPDATE … SET state='extracted', current_stage='embed', attempts=0, last_error=null
  //   WHERE id=$1 AND state='pending' RETURNING id   (mirrors completeStage)
  const advanced = await advancePendingToExtracted(itemId);
  if (advanced) await enqueueStage(boss, 'embed', itemId);
}
```

- `transcribe` has its **own** dead-letter queue — the shared `failed-items` handler only ever
  `markFailed` (state=`failed`), which is wrong for transcribe. Keeping it separate preserves that.
- `advancePendingToExtracted` is a conditional UPDATE guarded on `state='pending'`; a redelivered
  success **or** dead-letter job re-running is a no-op (the duplicate `embed` enqueue is then
  dropped by `embed`'s own runner guard). It writes `current_stage='embed'` — the only place
  `current_stage` leaves `'extract'` for a transcribed item.

### Dual-dispatcher wiring

- **loop.ts**: `boss.work(TRANSCRIBE_QUEUE, …runTranscribe)` + `boss.work(TRANSCRIBE_DEAD_LETTER, …handleTranscribeDeadLetter)`.
- **batch.ts**: include both in the drain order **after `extract`, before `embed`** (so a
  transcribe job + its terminal can cascade in one invocation). Inert under serverless (policy
  short-circuits to `skipped_serverless` before any enqueue) but wired for symmetry.

---

## 3. `transcribe-policy.ts` (pure function)

Single chokepoint. Async paste means **`extract` is the only caller** (the web paste request just
creates the item; the worker probes + decides) — the spec's "auto + manual paths call the same
function" concern dissolves. `durationSec` for direct-media paste comes from the **remote ffprobe**
in `extract` (§4); for podcast it comes from `itunes:duration` (ffprobe fallback).

```ts
export type TranscribeDecision =
  | { kind: 'transcribe' }
  | { kind: 'confirm'; estimatedMinutes: number }
  | { kind: 'skip'; status: 'skipped_too_long' | 'skipped_serverless' };

export function transcribePolicy(i: {
  durationSec: number; isAdhoc: boolean;
  deployMode: 'docker' | 'serverless';
  autoLimit: number; manualLimit: number;       // video_auto_limit / video_manual_limit
}): TranscribeDecision;
```

Branch order (first match wins):
1. `deployMode==='serverless'` → `skip skipped_serverless` (§11.2 — minute-scale work can't fit a 10s budget).
2. `durationSec ≤ autoLimit` → `transcribe` (auto **and** adhoc).
3. `!isAdhoc && durationSec > autoLimit` → `skip skipped_too_long` (auto sources never prompt).
4. `isAdhoc && autoLimit < durationSec ≤ manualLimit` → `confirm` (`estimatedMinutes = durationSec/60`).
5. `isAdhoc && durationSec > manualLimit` → `skip skipped_too_long` (**revises** §6.2 "拒绝粘贴"; see §10).

Cost is shown as **audio minutes only**, never converted to money (spec §5.3 ai_usage note).

---

## 4. Inputs

### Direct-media URL paste

Paste resolution (`sources/resolve.ts`) gains a direct-media branch: URL whose `Content-Type` is
`audio/*`/`video/*` or whose extension is a known media type (`.mp3 .m4a .wav .ogg .mp4 .webm …`).
Such an item → `content_type` by detected media type (`'audio'`/`'video'`), `media_url = url`, then
the §1 handoff. **No synchronous duration probe in the web tier** (keeps ffmpeg/ffprobe worker-only);
the item shows stage progress like any paste.

### Podcast RSS `<enclosure>`

`sources/rss.ts` `fetchItems` parses `<enclosure type="audio/*">` and `<itunes:duration>`. An episode
item carries: `url = <link>` (human-facing episode page), `media_url = enclosure URL` (download
source), `content_type='audio'`, `video_duration` from `itunes:duration` (fallback: ffprobe in
`extract`).

**This is an interface change, not a comment.** Today `RawItem` carries none of these and
`ingestSource` hard-codes `contentType: 'article'` (ingest.ts:55). The plan must:
- extend `RawItem` with `mediaUrl: string | null`, `contentType: ContentType`, `videoDuration: number | null`;
- have `ingestSource` write `contentType: r.contentType ?? 'article'`, `mediaUrl: r.mediaUrl`,
  `videoDuration: r.videoDuration` (no longer a literal `'article'`);
- thread the same three fields through the items insert + schema (`media_url` column, §9);
- test the RSS parse → insert path (an `<enclosure audio/*>` + `<itunes:duration>` episode lands as
  `content_type='audio'`, `media_url=<enclosure>`, `video_duration=<parsed>`).

`media_url` (new nullable column) is the **download source**, distinct from the canonical `url`.
`transcribe` downloads from `media_url ?? url`.

### Probe / download boundary (hard limits)

The dangerous case is a huge file: `manual_limit` must bite **before** a multi-GB download. So
duration is resolved cheaply and remotely first; the full download happens only for an
already-within-limit item.

- **Probe = remote, at `extract`.** For direct-media paste, `extract` runs `ffprobe` **against the
  remote URL** (ffprobe reads only headers / the moov atom — a few hundred KB, not the whole file) to
  get `durationSec`, then calls `transcribePolicy`. Guards: scheme allowlist `{http, https}` only,
  max redirects = 5, connect/read timeout, `-probesize`/`-analyzeduration` caps. A probe that fails
  *transiently* throws → consumes `items.attempts` (extract retry). A probe that resolves the URL as
  *not media* → degrade to `unavailable` + continue (no transcribe).
- **Download = local, at `transcribe`.** Only after policy says `transcribe` does the engine pull the
  whole file to `os.tmpdir()`. Guards: same scheme allowlist + redirect cap; a `Content-Length`
  precheck against a **generous constant byte ceiling** (`TRANSCRIBE_MAX_BYTES`, a code constant — not
  a `user_settings` column; duration is the real gate, the byte cap is only a runaway / mislabeled-
  content guard); a streaming byte counter that aborts if the body exceeds the ceiling even when
  `Content-Length` lied; tmp cleanup in `finally` on success **and** failure.

---

## 5. Transcribe engine (`pipeline/transcribe.ts`)

1. **Download** `media_url ?? url` to `os.tmpdir()` (whole file; streaming/resume out of scope) under
   the §4 download guards. Cleanup in `finally` on success **and** failure.
2. **Probe + extract audio** via ffmpeg; transcode to a Whisper-friendly format.
3. **Chunk** into 10-min windows with 5-s overlap (also keeps each chunk under the typical 25 MB
   Whisper upload limit).
4. **Transcribe** chunks concurrently, **`p-limit(3)`** (unbounded `Promise.all` on an ~18-chunk 3h
   audio trips endpoint rate limits). Request `verbose_json` to get segment timestamps.
5. **Merge** by **absolute timestamp**: offset each chunk's segments by its start; in the 5-s overlap,
   drop later-chunk segments whose `start` falls before the previous chunk's effective end. v1 does
   **no** fuzzy text alignment. Endpoint without timestamps → degrade to chunk-granular segments.
6. **Write** timed `transcript_segments [{start,end,text,speaker?}]` (same contract as M2a subtitle
   adapters) + flattened `raw_content`. `speaker` filled **only** when the endpoint returns
   diarization labels (e.g. Deepgram); OpenAI-compatible Whisper → no `speaker` (acceptable).
7. **Record usage** via the new whisper wrapper: `kind='transcription'`, `duration_seconds`,
   `stage='transcribe'`, `itemId` (§6).

**Whisper client is new.** There is no `packages/core/src/ai/whisper.ts` today — the plan **adds** the
thin Whisper-API-compatible client (it is not in Vercel AI SDK) **together with** its `recordUsage`
wrapper (§6); this is not "extend an existing client".

**New runtime deps (call out in the plan):**
- `p-limit` is **not** a current dependency — add it to `packages/core` (the engine lives in core).
- `ffmpeg` + `ffprobe` are **not** in any Dockerfile — add them to the **worker** image
  (`apt-get install -y ffmpeg`; ffprobe ships with it). Web image stays ffmpeg-free (probe is
  worker-only).

---

## 6. ai_usage consolidation (prerequisite — land first, own PR)

Today `recordUsage` is called at **5 sites** (`pipeline/embed`, `pipeline/score`, `pipeline/summary`,
`items/deep-summary`, `search/hybrid`) and `UsageFields.kind` is `'llm'|'embedding'` only.

- Move recording **into the `core/ai` wrapper layer**: `resolveLLM` / `resolveEmbedding` results and
  the new whisper client accept a `ctx` (`stage`, `itemId?`, `conversationId?`) and record once.
- **Delete all 5 call-site `recordUsage` calls** (spec §5.3: 收口时须同步删除调用点埋点防双计).
- Extend `UsageFields`: `kind` += `'transcription'`; add `durationSeconds` (transcription has no tokens).
- Migration adds `ai_usage.conversation_id uuid` (null; unused until M4 — migrated now while the
  table is small, spec §5.3) and `ai_usage.duration_seconds int` (null).

> Main spec §5.3 already **documents** `conversation_id`, `kind='transcription'`, `duration_seconds`,
> and the "记账收口到封装层 + 删调用点埋点" rule (lines 325–344). M2b is the **implementation** of that
> documented design — Task 0 does not need to add it to the main spec; it only confirms the foreshadowed
> M2 migration timing.

---

## 7. `needs_confirmation` + confirm sub-flow (UI)

- New `transcript_status` value **`needs_confirmation`** (plain-text column → no DB migration; **TS
  union must widen**, see §7-bis). Only ever set on adhoc/paste items (auto sources never prompt).
- **Confirm endpoint** `POST /api/items/[id]/confirm-transcribe` → core flips
  `needs_confirmation → pending`, computes `transcribeBudgetSec(durationSec)`, and enqueues
  `transcribe`. **Guarded on `state='pending' AND transcript_status='needs_confirmation'`** (not status
  alone) so a double-submit — or a submit on an item that already advanced — is a no-op. Reject/ignore
  simply leaves it parked.

**Functional pass (must build + test now — NOT deferrable as polish):**
- `<audio controls>` rendering for `content_type='audio'` items (source = `media_url ?? url`).
- "确认转写" button → calls the confirm endpoint; double-click / re-submit is a no-op (endpoint guard).
- `transcript_status` → UI status mapping **including `needs_confirmation`** (§7-bis) + zh/en i18n keys.
- Processing state (after confirm: shows `transcribing`) and error/degraded state (`unavailable`)
  render correctly.

**Deferred to impeccable polish (visual only):** the *look* of the audio block and the confirm
action — mark with a structurally-neutral `{/* DESIGN-GAP */}` shell (correct semantics/layout, zero
flourish, no invented tokens). Behavior, states, i18n, and tests above are **not** part of this defer.

### 7-bis. The `needs_confirmation` status must not fall through to "pending"

`TranscriptBadge` folds any unknown status to `pending` (TranscriptBadge.tsx:23) and `TranscriptStatus`
(sources/types.ts:10) has no `needs_confirmation`. Without explicit handling, a parked item renders as
"转写中" — wrong, and a **functional** bug, not a visual one. The plan must:
- add `'needs_confirmation'` to the `TranscriptStatus` union;
- add it to `TranscriptBadge`'s `STATUS`/`DOT` maps (a distinct, calm "awaiting" treatment — recessive,
  not the moss "present" accent, not an error red) with zh/en `transcript.needs_confirmation` keys;
- (the `pipeline-view` mapper needs no special-case beyond the union widening — see §8).

---

## 8. Panel / observability integration

- **User-step mapping** (`items/pipeline-view.ts`): **no logic change needed** beyond widening the
  `TranscriptStatus` union. Because `current_stage` stays `'extract'` through the transcribe/confirm
  window (decision #7), `mapStep` already computes `activeIndex===1` and passes `transcript_status`
  straight through as `transcriptSub` — so `(pending ∧ transcript_status=pending)` surfaces as
  **"transcribing"** and `(pending ∧ needs_confirmation)` as **"awaiting confirmation"** with the
  existing code. This is *why* decision #7 keeps `current_stage='extract'`.
- **Orphan/stuck detection** (M1c failure banner): **exclude** `needs_confirmation` items — they wait
  on the user, they are not stuck.
- **Queue health** (`/admin/jobs` queue-status surface): include `TRANSCRIBE_QUEUE` (and its
  dead-letter) in the queue-health listing so a backed-up transcribe queue is visible.
- **Cost panel** (`pipeline/status.ts`): add a **transcription lane** keyed on `kind='transcription'`,
  summing `duration_seconds` as audio-minutes (no token sum, no money — §5.3).

---

## 9. Migrations + schema + deps

Two migrations (both small). `drizzle-kit generate` requires `EMBED_DIM`/`DATABASE_URL`/`SESSION_SECRET`
in env or the snapshot records `vector(undefined)`.

1. **ai_usage**: `+ conversation_id uuid` (null), `+ duration_seconds int` (null).
2. **items**: `+ media_url text` (null) — download source distinct from canonical `url`.

No migration for new **text** values: `transcript_status='needs_confirmation'`, `content_type='audio'`,
`ai_usage.kind='transcription'` (TS unions only — these columns have no DB enum/CHECK).

**Deps / image changes (not migrations, but plan must list):** `p-limit` → `packages/core`;
`ffmpeg` (+ ffprobe) → worker Dockerfile only.

---

## 10. Spec deltas to land (main design `2026-05-27-benkyou-design.md`)

§10 is split so Task 0 knows exactly what to touch. **List A is already in the main spec** (M2b only
implements it); **List B must be edited into the main spec as Task 0, before any code task.**

### A. Already documented in the main spec — M2b implements, no edit needed
- `ai_usage.conversation_id`, `ai_usage.duration_seconds`, `ai_usage.kind='transcription'` (§5.3
  schema, lines 328–335).
- Accounting consolidates into the `core/ai` wrapper layer + delete the call-site `recordUsage` 埋点
  (§5.3 "记账位置" note, line 342).
- "不折算金额 / 粘贴 modal 成本预估降级为预估转写时长" (§5.3 note, line 343).
- M2 migration timing for the above (§5.3 note, line 344).

### B. Still missing / contradictory — edit into the main spec as Task 0
- **§5.3 schema**: `transcript_status` enum += `needs_confirmation`; `content_type` += `audio`;
  `items` += `media_url`.
- **§6.2 line 460**: over-`manual_limit` paste → **reuse `skipped_too_long` + continue** (was
  "拒绝粘贴 / 前端同步报错"). Rationale: async paste + ffmpeg-worker-only means duration is known only
  in `extract`; a synchronous reject would force ffprobe into the web tier.
- **§6.2 line 457**: the transcribe policy runs **only in `extract`** (async paste — the web tier
  just creates the item; the worker probes + decides). Drop the "web 手动粘贴路径同步调同一函数"
  framing; the single-caller model replaces it.
- **§6.2 transcribe ownership** (new text): the generic `StageOutcome.advance` seam (no
  transcribe-named guard hole); `transcribe` as its **own** queue + **own** dead-letter
  (`unavailable`+continue, never `failed`); `retryLimit=2` hardcoded, independent of
  `pipeline_max_attempts`; **per-job `expireInSeconds = transcribeBudgetSec(durationSec)`** on the
  transcribe queue (not a queue-wide constant, and explicitly *not* `= video_manual_limit`);
  `current_stage` stays `'extract'` across the transcribe/confirm window.
- **§15 milestone table**: M2b row — open decisions (seam shape / retry-counter home /
  `skipped_serverless` expression / job-expiry model / `current_stage` home) resolved as above.

---

## 11. Testing (TDD targets)

- `transcribePolicy` — every branch: serverless; `≤autoLimit` (auto+adhoc); auto `>autoLimit`; adhoc
  confirm range; **adhoc `>manualLimit` → `skipped_too_long`** (direct-media over-limit skip).
- `transcribeBudgetSec` — monotonic in `durationSec`; includes the fixed overhead; a short audio still
  gets `≥ overhead`.
- Runner seam — `extract` returning `{advance:false}` parks the item at `pending` with
  `current_stage='extract'`; uniform guard unchanged for the other stages.
- `runTranscribe` guard — drops a job when `state≠pending` or `transcript_status≠pending`.
- Transcribe terminal — exhausted retries → `unavailable` + `state=extracted` + `current_stage='embed'`
  + `embed` enqueued (**not** `failed`); redelivered dead-letter is a no-op.
- Probe/download caps — over-byte-ceiling download aborts + cleans tmp; non-`{http,https}` scheme
  rejected; `Content-Length`-lies streaming abort.
- Confirm endpoint — flips `needs_confirmation → pending` + enqueues once; **double-submit is a no-op**
  (guarded on `state='pending' AND transcript_status='needs_confirmation'`).
- Audio detail render — `content_type='audio'` item renders `<audio>` + transcript; `needs_confirmation`
  renders the confirm action (not the "transcribing" badge).
- `TranscriptBadge` / i18n — `needs_confirmation` maps to its own status (not folded to `pending`);
  zh + en keys present (`check:i18n`).
- Chunk merge — overlap-region timestamp dedup; chunk-granular fallback when no timestamps.
- ai_usage consolidation — each provider wrapper records exactly once; the 5 ex-call-sites record
  zero (no double-count).
- Podcast RSS — `<enclosure audio/*>` + `<itunes:duration>` → `media_url` + `video_duration` +
  `content_type='audio'` through `RawItem` → `ingestSource` insert.
- Queue health includes `TRANSCRIBE_QUEUE`; serverless mode skips transcribe (policy →
  `skipped_serverless`, no enqueue).

---

## Out of scope / explicitly deferred

`yt-dlp` and YouTube/Bilibili audio download (gated audio needs the deferred PoToken/SESSDATA
credential model — its own milestone); audio file upload; chunk-level resume; richer diarization;
backfill of M2a-era `unavailable` items.
