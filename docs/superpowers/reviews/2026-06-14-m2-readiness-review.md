# M2 Readiness Review — Brainstorming Handoff

Date: 2026-06-14. Produced before the M2 `brainstorming` session as its input.
Supersede with the M2 brainstorm doc + plan once written; delete after the M2 plan lands.

## Status

- UI design-system branch `feat/impeccable-ui` is reviewed, **pending merge to main**.
  Brainstorm M2 *after* that merge — the failure-banner's 🔧/🎨 routing depends on
  DESIGN.md being on main.
- AGENTS.md dispatcher pointer already fixed (`AGENTS.md:51`).
- M2 = source expansion (spec §15): YouTube/Bilibili subtitles, video transcription,
  URL paste (dup-jump + stage-level progress), pipeline failure banner, + 3 prereq migrations.

## Read first (recoverable from repo — listed so the session doesn't re-derive)

- spec §15 M2 row; §6.2 (extract dispatcher + transcribe state-ownership, marked "M2 前定死");
  §5.3 (3 prereq migrations + ai_usage ledger notes); §11.2 (serverless transcription boundary).
- M1c plan tail (`docs/superpowers/plans/2026-06-10-m1c-observability.md:2614`) —
  leftovers + M2-relevant e2e/process notes (incl. global-setup asserting the e2e DB name).

## The non-obvious part: code diverges from the spec's target architecture

The spec *describes* the target; nothing in the repo tracks that M1 code isn't there yet.
These three gaps are the reason a Phase 0 exists. **Re-verify each file:line before planning**
(the UI merge shouldn't touch these backend files, but confirm — don't trust this brief blindly).

### 1. `extract` is a god function; `SourceAdapter` lacks `extract(item)`

- `SourceAdapter` only has `fetchItems()` — `packages/core/src/sources/types.ts:10-14`.
  Spec §4.1/§6.2 require an `extract(item)` method on the adapter.
- Readability hardcoded in `packages/core/src/pipeline/extract.ts:37-49`;
  `contentType:'article'` hardcoded at `extract.ts:47` and `pipeline/ingest.ts:49`.
- Risk: M2's three sources get piled into `extract.ts` instead of behind the adapter.
  **Refactor the adapter interface + make the extract stage a pure dispatcher BEFORE adding any source.**

### 2. Runner can't defer state advancement — the transcribe path is unrunnable as-is (biggest one)

- `runItemStage` unconditionally `completeStage` + enqueues the next stage on handler
  success — `packages/core/src/queue/runner.ts:33-35`.
- Conflicts with spec §6.2 (line 471): a transcribing item must stay `state='pending'`
  until the transcribe sub-task reaches a terminal `transcript_status`, then *it* advances
  the item to `extracted`.
- If reused as-is: extract succeeds → `state='extracted'` → embed runs on `raw_content=null`
  → item reaches `done` on title only → transcript arrives later → the at-least-once state
  guard (`runner.ts:23-24`) drops the reflowed job → **transcript is never embedded/searchable.**
- Needs a new control-flow seam: "handler completed, but advancement is handed off to a sub-task."

### 3. Transcribe doesn't fit the dispatch skeleton

- `queue/loop.ts:24` and `queue/batch.ts:26` iterate `PER_ITEM_STAGES`; transcribe isn't one
  (separate queue, separate retry). Both dispatchers need bespoke wiring.
- `getQueueHealth`'s queue list is a hardcoded SQL array — `pipeline/status.ts:42`.
  Add transcribe or it's invisible in the panel (and it's not driven by `PER_ITEM_STAGES`, so easy to miss).
- Transcribe's independent retry counter has no home: the `state.ts:61-94` helpers are all
  `items.attempts`, but spec §6.2 says transcribe "不混用 items.attempts".
- `getInFlight` + the panel's >30min "疑似卡死" highlight false-flag legit long transcriptions
  (`video_manual_limit` default 10800s = 3h) — `pipeline/status.ts:68`.

## Prereq migrations (confirmed not done)

1. **search_vec truncation** — `schema.ts:151` / `migrations/0000_initial.sql:75` still
   `coalesce(raw_content,'')`, no `left(...,100000)`. Spec §5.3 ⚠️: a multi-hour transcript
   overflows the tsvector ~1MB cap → INSERT/UPDATE errors → that item permanently fails
   (deterministic, not edge case). **Must be the first M2 migration, before any transcription lands.**
2. **ai_usage**: add `conversation_id` (FK → conversations, table already exists), `duration_seconds`,
   and allow `kind='transcription'` — `schema.ts:181-199`.
3. **sources.consecutive_failures** — `schema.ts:86-97` (spec §5.3 line 246, "M2 落地").

## Ordering constraint

M1c leftover #3: consolidate usage instrumentation into the `core/ai/` wrapper layer (and add
the missing `deep_summary` usage test) **before** adding transcribe metering — otherwise transcribe
becomes a 4th per-call-site instrumentation that the consolidation then has to unwind, with
double-count risk. Spec §5.3 "记账位置" note: consolidating *must* delete the per-call-site
`recordUsage` calls.

## Open decisions for brainstorming to lock (not decided anywhere yet)

1. Transcribe retry-counter home: pg-boss `job.retryCount` vs. a new `transcribe_attempts` column.
2. Runner deferred-advancement seam shape: handler returns a "handed-off, don't advance" signal
   vs. transcribe modeled as a special stage with custom required/result states.
3. How `pipeline/transcribe-policy.ts` (pure fn, shared by web paste path + worker auto path)
   expresses the serverless boundary (`skipped_serverless`) alongside the duration branches.
4. Failure banner 🔧 vs. 🎨: depends on whether (post-merge) DESIGN.md has an alert/banner
   primitive — if not, leave a `{/* DESIGN-GAP */}` shell for the impeccable polish pass.

## Triage decision (already made this session)

Everything above except the AGENTS.md fix → **M2 Phase 0 (foundation, all 🔧 pure-logic)**,
before the source-expansion phases. Do #2 (runner seam) first, TDD, with the transcribe path as
its validation. Do NOT do any of this as out-of-plan hotfixes — geardown on the core state machine
with no consumer = unvalidated changes sitting on main.

## What does NOT need to travel (recoverable, don't re-derive)

M2 scope (spec §15), transcribe design + state-ownership rationale (§6.2), the 3 migrations'
rationale (§5.3), serverless boundary (§11.2), the superpowers×impeccable routing workflow
(AGENTS.md). The new session reads those directly.
