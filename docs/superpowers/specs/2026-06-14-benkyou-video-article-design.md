# Video → Illustrated Article — Design (按需图文稿)

Date: 2026-06-14. Brainstorm output for the **"video → high-quality illustrated article"** feature
(turn a video into a blog-like, editable document that combines transcript with the necessary
screenshots, adapted per content type: tutorial / podcast / news).

The authoritative design remains `docs/superpowers/specs/2026-05-27-benkyou-design.md`
(referenced below as "spec §X"). This doc records only the **locked decisions** and the **spec
deltas** they imply — it does not restate the spec. It deliberately stops at the design; **no
implementation plan is written yet** (see §"Why no plan yet").

---

## What this is — and what it is not

A **new, on-demand product surface**: from a video item, synthesize a structured, editable,
blog-like article. It is built **on top of** the transcription substrate already in the roadmap —
it does not replace it.

- **Substrate (already planned):** video → text. M2a fetches subtitles → `raw_content`; M2b runs
  Whisper (chunked + diarization) → `raw_content`. This produces *raw transcript text*.
- **This feature (new):** `raw_content` (+ optionally video frames) → a *synthesized, illustrated,
  per-type, editable article*. The closest existing scope item is spec §3.2's v2 line
  「教学视频画面识别(关键帧 OCR + 多模态 LLM)」 — which is reshaped by this doc (see §6).

**It is NOT:** a pipeline stage; in the retrieval/embedding/scoring/agent path; an M2a item; a
multi-tenant or per-user artifact (single-user invariant unchanged).

---

## Prerequisite — timed transcript contract (upstream delta to M2a/M2b)

v1's `timestamp-link` block and the phase-2 `speech-density` heuristic both assume the transcript
carries **per-segment timing**. Today that is not guaranteed: M2a commits only to `raw_content`
(flattened text), and M2b's spec stores `transcript_segments` **only when diarization is present**.

**Contract (add to M2a + M2b):** every transcript path populates the existing
`items.transcript_segments` jsonb as a **timed** array — `[{ start, end, text, speaker? }]`:
- **M2a subtitle adapters** parse cue timing (SRT/VTT cues already carry start/end) into segments,
  *in addition to* the flattened `raw_content` used for search/embedding. `speaker` only if the
  platform provides it.
- **M2b Whisper** always stores segments with timing (not only under diarization); `speaker` only
  when diarized.

Without this, v1 still works but **degrades to a no-timestamp text article** (no jump-links, weaker
structure). Because it touches M2a/M2b — *earlier* milestones, being designed on this very branch —
it is flagged now to avoid a backfill later (recorded in "Spec deltas").

---

## Core decisions (locked in brainstorm)

1. **Trigger = on-demand, independent subsystem.** A "生成图文稿" action on the video detail page
   enqueues a background job that is **not** in `PER_ITEM_STAGES` and **never touches `items.state`
   or the `runner.ts` state machine**. It is, however, an **independent pg-boss queue that must be
   registered/consumed in both runtime modes** (docker worker loop + serverless `processBatch`) — a
   non-pipeline queue still needs a consumer in each mode (see Phase 1). Cost is incurred only when
   the user asks. This isolates blast radius and matches the editable nature (a user who edits is
   actively studying that one video).
2. **Image strategy = hybrid.** A few **real key screenshots** for genuine value-frames
   (code / diagram / slide change) + **timestamp/range deep-links** for everything else
   (`?t=` on YouTube/Bilibili). Not every frame is stored.
3. **Block types over the video timeline:**
   - *Narrative* (v1) — transcript-driven prose, with the occasional key frame (frames are v2).
   - *Step list* (v1) — when the **transcript itself** enumerates a sequence ("first… then…"),
     emit a numbered step list with `timestamp` / `timestamp-range` links. Pure text — no frames,
     no detection.
   - *Operation-segment* (**v2 only**) — for "presenter operating, low speech, content lives on
     screen" spans the transcript can't carry: detected via low speech-density + high visual-change,
     then narrated from a **denser frame sample** + range jump-link. A linear operation is a step
     list, **not** a flowchart. Detection needs ffmpeg visual-change, so it **cannot** exist in the
     text-only v1; v1's step lists come only from explicit transcript cues.
   - *Mermaid flowchart = stretch goal, explicitly deferred.* It is an **orthogonal** capability
     (suits branching/structural explanation — algorithm / architecture / decision flow — which
     can occur in any content type), not the answer to the operation-segment case. Multimodal-
     generated diagrams are frequently unfaithful and add a render dependency.
4. **Two-layer split + roadmap placement** (the key structural insight — the feature has a natural
   seam where cost differs by an order of magnitude):
   - **Phase 1 — text layer → v1**, a milestone **after M3** (rides M3's per-type prompt branch and
     M2b's full-video transcription). **Zero new infrastructure.**
   - **Phase 2 — visual layer → v2** (post-M6 launch), **gated behind M2b** (media-fetch + ffmpeg +
     `ai_usage` extension) **and multimodal capability**. This is §3.2's reshaped v2 item.
5. **Retrieval role = reading-only.** The article does **not** enter embedding / scoring / Q&A
   retrieval — `raw_content` remains the retrieval substrate. Otherwise a user edit would force
   re-embed + re-score, dragging the just-isolated artifact back into the pipeline and creating a
   "content changed after done" inconsistency window. The article is for human reading.
   **Hard boundary:** article generation / edit / regenerate must **not** write any
   retrieval-relevant `items.*` column — not `raw_content`, `summary`, `deep_summary`,
   `topic_tags`, `depth_score`, `topic_score`, or `category` — and the article must **not** be read
   by Agent tools (M4 `get_item_detail`, etc.). It lives **only** in `item_articles` /
   `article_assets`, so it cannot leak into `search_vec` (generated from title+summary+raw_content)
   or into the agent's context.
6. **Multimodal missing = graceful degrade.** No multimodal endpoint configured → still produce a
   clean text article (transcript-driven + timestamp links), just without smart screenshots /
   operation-segment frames. Visual features are gated in the UI with a clear "needs a multimodal
   endpoint" affordance. Consistent with BYO-AI (spec §2; not every endpoint is multimodal —
   text-only Ollama / DeepSeek-text).
7. **Storage = local volume by default** (image count is small in the hybrid model); `bytea` is an
   acceptable zero-infra fallback; S3-compatible only matters for serverless — which does not run
   the visual layer anyway (see 10). Final backend chosen at the phase-2 plan.
8. **Edit / regenerate.** The article is stored and user-editable. Regenerate is an **explicit**
   action that **warns before overwriting** edits. No version history in v1.
9. **Per-type adaptation = prompt templates keyed off two existing axes.** `videoKind` is the
   video's **form** (free-text column in `items`; conventional values per spec §9.3:
   `auto / interview / tutorial / talk / other`; M3 already branches on it for scoring). The block
   vocabulary is shared; templates vary which blocks / tone / density. The three target scenarios
   map as: **technical tutorial → `videoKind='tutorial'`**, **multi-person podcast →
   `videoKind='interview'`**, **tech news → `category='news'`** (usually with `videoKind='other'`).
   `news`/`资讯` is a **content class** that already lives on the separate `items.category` axis
   (set by the M3 score branch) — so the news template is selected by `category`, **not** by adding
   a value to `video_kind`; this keeps video *form* and content *class* from mixing.
   Interview/podcast quality depends on **diarization** (subtitle speaker tags or a Deepgram-style
   endpoint, per spec §6.2 / README recommendation).
10. **Serverless boundary.** The **visual layer is unsupported on serverless** — same reasoning as
    transcription (spec §11.2): ffmpeg + blob handling do not fit a 10s budget; a half-finished,
    killed-then-retried job means repeated cost. The **text layer (LLM-only) works on serverless
    only within budget**: the serverless worker is the `/api/cron/work` batch model, so a
    long-transcript generation can itself overrun the function budget and replay the same
    timeout → retry → repeat-cost failure. Rule: attempt only when the transcript fits a token/time
    budget; over budget → **fail fast or emit a truncated article**, with **no long-task retry**
    (low max attempts). (Simpler alternative, if we'd rather not maintain a budget estimate: gate
    text-layer generation off on serverless entirely, like transcription.)

---

## Difficulty (per component)

| Component | Difficulty | Note |
|---|---|---|
| Text layer: typed-block article + per-type prompts + editable + storage | **Low–Med** | Prompt engineering + one table + reader/editor UI + on-demand job. The block editor is the main lift. No state-machine change. |
| Media fetch + ffmpeg frame extraction | **Med**, mostly **shared with M2b** | M2b already "fetch media + ffmpeg-extract audio". Frames = same substrate, different filter. |
| Blob storage (hybrid → few images) | **Low** | `bytea` or local volume; S3 only for serverless (which doesn't run this). |
| Multimodal frame selection + operation-segment narration | **Med–High** | The real algorithmic/quality work: scene-change candidates → multimodal "informative? + caption"; operation-segment heuristic + step narration. Needs tuning. |
| Per-type adaptation (tutorial / podcast / news) | **Low** | Prompt templates off `videoKind` form (+ `category='news'` for news). Shared block vocabulary. |
| Edit / regenerate semantics | **Low–Med** | Cheap **because** it stays out of the retrieval path. |

**Cost inversion to remember:** "few screenshots + links" is cheap *because* multimodal calls are
few. Operation-segments invert this — a 40-min live-coding video is *mostly* operation-segments →
dense frames → the **most** multimodal calls. The most visually-dependent video is the most
expensive to convert. On-demand mitigates (the user opted in), but phase 2 must cap a **per-
conversion frame budget** and an operation-segment frame-density ceiling.

---

## Phase 1 — Text layer (v1, milestone after M3)

- **Data model (new):** `item_articles` — one row per generated article.
  ```
  item_articles
    id            uuid pk
    item_id       uuid not null references items(id) on delete cascade
    status        text not null default 'generating'  -- 'generating' | 'ready' | 'failed'
    blocks        jsonb not null default '[]'          -- ordered typed blocks (see vocabulary)
    model         text                                 -- generator model id (drift/debug)
    edited        boolean not null default false       -- user has edited; guards regenerate
    last_error    text
    created_at    timestamptz not null default now()
    updated_at    timestamptz not null default now()
    unique (item_id)                                   -- one article per item (regenerate overwrites)
  ```
- **Block vocabulary (typed, jsonb):** `heading`, `paragraph`, `code`, `quote`, `list` (incl.
  numbered step lists), `timestamp-link` (label + seconds), `timestamp-range` (start + end). **v1
  emits these.** `operation-segment` (detection + denser frames + range narration) and `image`
  (`article_assets` ref) are **v2 only** — v1 never emits them (operation-segment needs ffmpeg
  visual-change detection; see decision 3).
- **On-demand job:** an **independent pg-boss queue** `generate-article` (item id in the payload),
  **registered and consumed in both runtime modes** — the docker worker loop **and** the serverless
  `processBatch` — but **not** part of `PER_ITEM_STAGES` / `runner.ts`. It writes
  `item_articles.status`, **never** `items.state`, and is exempt from the §6.1 at-least-once state
  guard (which governs only pipeline stages). "Not a pipeline stage" ≠ "no dispatcher wiring": a
  non-pipeline queue still needs a consumer registered in each mode.
- **Per-type templates** keyed off the `videoKind` **form** (`auto / interview / tutorial / talk /
  other`) plus `category`; the **news/资讯 template derives from `category='news'`** (separate
  axis), not from a `video_kind` value (see decision 9).
- **Editor:** block-based reader + edit mode on the detail page. Net-new visual surface — mark
  `{/* DESIGN-GAP: article reader/editor */}` in the functional pass; impeccable polish later
  (per the superpowers×impeccable workflow in AGENTS.md).
- **Metering:** generation records `ai_usage` (`kind='llm'`, a new `stage='article'`). Phase 1 is
  LLM-only, so it fits the existing `ai_usage` shape — **no `ai_usage`-schema dependency on M2b**.
  (The text layer's one upstream dependency is the timed-transcript contract above, not a schema.)
- **Serverless:** supported (LLM-only) **only within a token/time budget** (decision 10);
  over-budget transcripts fail fast / truncate, no long retry.

## Phase 2 — Visual enrichment layer (v2, gated behind M2b + multimodal)

- **Frame extraction:** ffmpeg over the fetched media (reuse M2b's media-fetch + ffmpeg substrate).
- **Key-frame selection:** scene-change candidate frames → multimodal "is this informative? caption
  it" → placement. Bounded by the per-conversion frame budget.
- **Operation-segment detection:** low **speech-density** (from subtitle/transcript timestamps,
  already available) + high **visual-change rate** (ffmpeg scene detection) over a window. Detection
  needs **no new infrastructure** — only a heuristic + prompts. Output: denser frame sample +
  step-list narration + range link.
- **Image storage (new):** `article_assets` (article_id ref, ordinal, `bytea` or path/key, mime,
  width/height). Local volume default; S3 only for serverless (n/a here).
- **Multimodal graceful degrade** (decision 6); **per-conversion frame budget + density ceiling**
  (cost inversion).
- **Metering:** multimodal calls → `ai_usage`; relies on **M2b's `ai_usage` extension**.
- **Serverless:** unsupported (decision 10).

---

## Spec deltas to land

(Recorded here, not edited inline, to avoid colliding with the in-flight §15 M2a/M2b split on the
`m2a-brainstorm` branch — same convention as `m2a-design.md`. Land these when each phase is scheduled.)

- **M2a + M2b (timed transcript contract):** both transcript paths must populate
  `items.transcript_segments` as a timed `[{ start, end, text, speaker? }]` array — M2a from
  subtitle cue timing, M2b always (not only under diarization). Prerequisite for v1 jump-links and
  the phase-2 speech-density heuristic (see Prerequisite section). **Expands M2a/M2b scope — fold
  into the M2a design now**, since those milestones land first.
- **§3.2 (v2):** reshape 「教学视频画面识别(关键帧 OCR + 多模态 LLM)」 → "video → illustrated
  article: visual enrichment layer (key screenshots + operation-segment narration via multimodal
  LLM)". OCR is **subsumed** by multimodal captioning; drop the standalone OCR framing.
- **§15 (milestones):** add a **v1 milestone after M3** — "视频图文稿(文字层):on-demand
  transcript → typed-block editable article, per-`videoKind` templates, reading-only". Add the
  **visual layer to the v2 track** (post-M6), gated behind M2b + multimodal. (Exact slot of the
  text-layer milestone relative to M4/M5 is a scheduling call when M3 approaches.)
- **§5.x (data model):** add `item_articles` (phase 1) and `article_assets` (phase 2) when each
  phase lands.
- **§11.2 (serverless):** add the visual layer to the list of serverless-unsupported capabilities
  (alongside no-subtitle transcription), with the text layer noted as supported.
- **§9.3 / template selection:** the tech-news/资讯 template is selected from `items.category='news'`
  (existing axis from the M3 score branch) combined with `video_kind` — **not** by adding `news` to
  `video_kind` (that would mix video *form* with content *class*). No schema change.

---

## Open questions (parked for the per-milestone plan, not blockers)

- Per-conversion frame budget + operation-segment density thresholds — tune with real data.
- Operation-segment detection thresholds (speech-density, scene-change) — tune with real data.
- Block editor richness (WYSIWYG vs markdown-ish) — decide at the text-layer milestone's design.
- Whether to allow a **separate vision endpoint** config distinct from the main LLM — deferred;
  graceful-degrade covers v1.
- Mermaid flowchart "diagram block" — separate orthogonal stretch capability; its own mini-design.
- Diarization dependency for the podcast template (Deepgram-style endpoint quality).

---

## Why no implementation plan yet

The brainstorming default terminal state is `writing-plans`. That is **deliberately skipped here.**
Implementation plans in this repo are **per-milestone with pinned dependencies** (an audited
snapshot, per AGENTS.md). The text layer is gated behind M3; the visual layer behind M2b +
multimodal. Writing a plan now would pin versions and call sites that will be stale by the time the
milestone is built. **Invoke `writing-plans` when the text-layer milestone is actually reached**
(after M3), and again for the visual layer in v2.
