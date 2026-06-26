# Item lifecycle actions — reprocess, delete, and dedup-aware re-paste

**Date:** 2026-06-26
**Status:** Design (brainstormed, approved section-by-section)
**Amends:** main spec (`2026-05-27-benkyou-design.md`) §425 (admin-only retry) — adds per-item user-facing reprocess/delete; flags two implementation divergences from the main spec (§355 cluster FK, §748 CSRF — see §9).

---

## 0. Problem & evidence

After the yt-dlp YouTube backend merged (PR #20), a previously-pasted YouTube URL that *now* has a working caption path still "looks broken": re-pasting it does nothing visible. Concrete case: `https://www.youtube.com/watch?v=GOtHFZnagO0` still sits in the feed.

**Diagnosis — "处理失败的条目" is two different things, and this one is the easy-to-miss kind.** The feed only queries `state='done'` (`packages/core/src/items/queries.ts:51-52`; hard invariant "all user-visible queries filter `state='done'`"). So an item *visible in the feed* is necessarily `state='done'` — **not** `failed`. It succeeded and degraded to `transcript_status='unavailable'`: the old backend couldn't fetch captions, and per design §2's degradation contract, "no captions" is modeled as a **normal success**, never a failure.

Three layered causes make the fix "look like it didn't work":

1. **Re-paste hits URL dedup.** `pasteUrl` returns the existing item on any `url_hash` match regardless of state (`packages/core/src/items/paste.ts:22-27`), then silently navigates to it. Correct behavior on its own, but the silent navigation makes "I re-pasted" feel like a no-op.
2. **The existing retry path can't reach it.** `/admin/jobs` lists only `state='failed'`; `retryItem()` explicitly refuses `state='done'` (`packages/core/src/pipeline/retry.ts:36`), and a done item's `current_stage` is `null` anyway.
3. **No re-extract entry exists for a `done` item at all** — this is the real gap. The `failed` bucket already has a remedy (admin retry, which now succeeds post-merge); the `done`-but-degraded bucket has none.

Separately: there is **no per-item delete UI** anywhere (the main spec only designs source-level delete, §250).

**Conclusion:** the adaptation needed is the ability to *reprocess a `done`/degraded item from extract* and to *delete an item* — not a change to URL dedup (dedup is correct).

---

## 1. Concepts

### Two terminal buckets

| Bucket | State | How to recover today | Gap |
|---|---|---|---|
| Genuine failure | `state='failed'` | admin retry = **resume** from `current_stage` | only discoverable in `/admin/jobs` |
| Succeeded-but-degraded | `state='done'`, e.g. `transcript_status='unavailable'` | **nothing** | re-extract path missing entirely |

### Engine vs UI split (decided)

The underlying engine supports re-enqueuing from **any** stage (near-zero cost to keep the door open for a future "re-summarize only" in M4). The **UI** deliberately exposes only two *named* actions — not a free-form stage picker:

- **Resume** (`从失败步续跑`): re-run from `current_stage`. Cheap; preserves upstream work. = existing `retryItem`.
- **Restart** (`从头重跑`): re-run from `extract`. Re-fetches the source (the only meaningful starting point when *the extract result itself* must be redone — e.g. captions now reachable).

**Why no free-form picker (YAGNI):** for the `done`+degraded case a picker is meaningless — captions are fetched at `extract`, so re-running from `embed`/`score`/`summary` only re-embeds the same stale content; `extract` is the only useful start. For the transient-failure case, resume-from-`current_stage` is already right. No third scenario is uniquely served by a picker (except "re-summarize only", deferred to M4 — the engine already supports it). A picker would expose 5-stage internals and require per-stage upstream-validity guarding, not worth it for a single-user app.

---

## 2. Reprocess engine

`packages/core/src/pipeline/reprocess.ts` (next to `retry.ts`).

**Refactor the shared tail out of `retryItem`:**

```ts
// resetAndEnqueue(itemId, stage):
//   state      = STAGE_REQUIRED_STATE[stage]   // 'extract' → 'pending'
//   current_stage = stage
//   attempts   = 0
//   last_error = null
//   enqueueStage(boss, stage, itemId)
```

- `retryItem(itemId)` — unchanged behavior: guards (not `done`, `current_stage` is a per-item stage), then `resetAndEnqueue(itemId, current_stage)`. (Now expressed via the shared tail.)
- `reprocessItem(itemId)` — **new**: guard `state ∈ {done, failed}` (reject in-flight — re-running a live item double-processes), then `resetAndEnqueue(itemId, 'extract')`.

**Properties:**

- **Self-healing transcribe handoff.** reprocess only re-runs `extract`; extract independently decides whether to hand off to Layer-2 `transcribe` (YouTube no-caption path). reprocess needs no awareness of transcribe.
- **Idempotent / no stale rows.** embed uses `onConflictDoUpdate` (`embed.ts:42`); dedup's unique index on `canonical_item` makes re-run reuse the cluster (`dedup.ts`); the old summary/`deep_summary` is overwritten by the new run.
- **Transient feed exit.** A reprocessed `done` item correctly leaves the feed (`state≠'done'`) until it re-reaches `done` — same as orphan retry, acceptable for single-user.
- **Cost.** Restart re-spends embed + summary (and possibly Whisper) tokens; metered in `ai_usage`. Acceptable for a manual single-user action; UI gates it behind a confirm (§3).

---

## 3. Item-page actions

Both render branches of `apps/web/app/(authed)/items/[id]/page.tsx` get an actions cluster, gated by state:

| Item state | Buttons |
|---|---|
| `done` (done view) | **从头重跑** (reprocess, confirm) · **删除** (confirm) |
| `failed` (progress view) | **从失败步续跑** (resume, primary) · **从头重跑** (reprocess, confirm, secondary) · **删除** |
| in-flight (`pending`…`scored`) | **删除** only (no reprocess/resume — already processing) |

- **Confirm dialog** on reprocess (point 4): "会重跑整条 pipeline,重新消耗 token。" Resume needs no confirm (cheap). Delete has its own destructive confirm (§5).
- Buttons are dumb client components in `apps/web/components/` (e.g. `ItemActions.tsx`), props-driven; markup goes through tokens (no raw hex / arbitrary values, per AGENTS.md). Mark a `DESIGN-GAP` for impeccable polish.

**API routes** (`apps/web/app/api/items/[id]/...`), each thin, guarded by `requireApiAuth()` (the project's existing mutation guard — see `apps/web/app/api/items/paste/route.ts`):

- `POST /api/items/:id/reprocess` → `reprocessItem(id)`
- `POST /api/items/:id/retry` → `retryItem(id)` (surfaces the existing capability on the item page; `/admin/jobs` keeps its own retry)
- `DELETE /api/items/:id` → `deleteItem(id)` (§5)

On reprocess/resume success the client navigates to the progress view (`router.refresh()` / push to `/items/:id`).

---

## 4. Dedup-aware re-paste

The current silent `router.push` on a dedup hit is the worst part of the UX — the user may not even realize the URL was already imported. Fix: surface status instead of navigating.

**`PasteResult` shape change** (`packages/core/src/items/paste.ts`; sole caller is the paste route):

```ts
type PasteResult =
  | { created: string }                                  // new item, pipeline started
  | { existing: { id: string; state: ItemState;
                  transcriptStatus: TranscriptStatus; title: string } };
```

`pasteUrl` selects those columns on the dedup-hit path (and the lost-insert-race path).

**Modal** (`PasteModal.tsx`): on `existing`, render an "already imported" panel instead of closing/navigating:

> **这条已导入过**
> 《{title}》 · 状态:{label}
> [查看] [重新处理]

- `label` from a small `describeItemStatus(state, transcriptStatus)` helper reusing the `mapStep` vocabulary (`packages/core/src/items/pipeline-view.ts`) → i18n key. Examples: 已完成·无字幕 / 处理失败于 {stage} / 处理中。
- **[重新处理] = restart from extract** (`POST …/reprocess`), then navigate to the item. Re-paste intent is always "redo fresh"; resume stays off the modal (no stage choice in the modal). Shown only when the existing item is `state ∈ {done, failed}` (matching `reprocessItem`'s guard); an in-flight hit shows status + [查看] only.
- **Token-cost note is inline** next to [重新处理] (no modal-on-modal); the visible status panel is itself the confirmation context.

---

## 5. Delete

`packages/core/src/items/delete.ts` → `deleteItem(itemId)`, in a transaction.

**Cascades that already exist** (verified in `schema.ts` / `0000_initial.sql`):

| Child | FK on delete |
|---|---|
| `item_embeddings.item_id` | `CASCADE` |
| `digest_items.item_id` | `CASCADE` |
| `ai_usage.item_id` | `SET NULL` (token ledger preserved) |

**Compensate for the missing cluster FK (divergence — see §9).** `event_clusters.canonical_item` has **no FK** (it's a bare `uuid` in `0000_initial.sql:31`, despite main spec §355 claiming `references items(id) on delete set null`). So deleting an item would leave `canonical_item` dangling at a nonexistent id. `deleteItem` cleans it in app code, robust for both the current dedup stub (1:1 item↔cluster) and future M3 multi-item clusters:

```
-- in a transaction, before/with deleting the item:
DELETE FROM event_clusters WHERE canonical_item = $id AND item_count <= 1;  -- owning 1:1 cluster
UPDATE event_clusters SET canonical_item = NULL WHERE canonical_item = $id;  -- future multi-item: re-elect next dedup (spec §516)
DELETE FROM items WHERE id = $id;
```

(Only items that reached the `dedup` stage own a cluster; pre-dedup `pending`/`failed` items match 0 rows — harmless. `items.cluster_id → event_clusters.id ON DELETE SET NULL` is the reverse direction and irrelevant here.)

**Mid-flight safety.** Deleting an in-flight item is safe: any queued job runs `runItemStage`, which reads `getItemState` and returns early when the item is gone (`runner.ts:26-27`, `getItemState` → `undefined ≠ required state` → no-op).

**Surfaces** (both, per request): item detail page + feed row (`apps/web/components/` feed item). Destructive confirm required ("删除后不可恢复"). After delete: navigate back to feed (detail page) / optimistic row removal + `router.refresh()` (feed). Feed-row control is structurally-neutral, `DESIGN-GAP`-marked.

---

## 6. Invariants & non-goals

**Preserved invariants:**
- 6-stage state machine untouched — reprocess only resets to a *legal front state* (`pending`) and re-enqueues, identical to a fresh paste.
- Search/feed `state='done'` pre-filter untouched.
- Single-user, no `user_id`.
- Delete uses existing cascades + app-level cluster cleanup; no schema migration required for this feature.

**Non-goals (this round):**
- Free-form stage picker / "re-summarize only" (deferred to M4; engine already supports it via `resetAndEnqueue(id, stage)`).
- Bulk select / bulk delete / bulk reprocess.
- Auto-reprocess on re-paste (kept explicit — system can't know reprocessing will improve a `done+present` item; user decides).
- Adding the `canonical_item` FK or CSRF middleware — both are pre-existing cross-cutting gaps, flagged in §9, out of scope here.
- Undo/trash for delete (hard delete only).

---

## 7. Testing (TDD where there's logic)

- `reprocessItem` (int): `done` → `state='pending'`, `current_stage='extract'`, `attempts=0`, `last_error=null`, extract enqueued; `failed` likewise; in-flight rejected; double-call idempotent (queue dedup).
- `retryItem` unchanged: existing tests stay green after the `resetAndEnqueue` refactor.
- `deleteItem` (int): item row gone; `item_embeddings` cascade-gone; `digest_items` cascade-gone; `ai_usage` row preserved with `item_id=NULL`; owning 1:1 cluster removed; `event_clusters` with `item_count>1` gets `canonical_item=NULL` (synthetic multi-item fixture).
- `pasteUrl` (int): dedup hit returns `{ existing: { id, state, transcriptStatus, title } }`; lost-insert-race path same shape.
- `describeItemStatus` (unit): state×transcriptStatus → expected i18n key.
- E2E (Playwright): item-page reprocess transitions to progress view; feed-row delete removes the item; re-paste of an existing URL shows the "already imported" panel.

---

## 8. File layout, scope, branch

**New / touched:**
- core: `packages/core/src/pipeline/reprocess.ts` (+ `resetAndEnqueue` refactor of `retry.ts`), `packages/core/src/items/delete.ts`, extend `packages/core/src/items/paste.ts`, `describeItemStatus` in `packages/core/src/items/pipeline-view.ts`.
- web API: `apps/web/app/api/items/[id]/reprocess/route.ts`, `…/retry/route.ts`, `…/route.ts` (DELETE).
- web UI: `ItemActions.tsx`, `DeleteButton`/`ReprocessButton`, feed-row delete control; wire into item page, `PasteModal.tsx`, feed; zh/en i18n keys.

**Scope:** three cohesive features; likely >200 LOC total → the implementation plan splits into per-feature tasks (engine+reprocess, re-paste, delete). Tagged 🔧 derivative/logic (reuses existing `DESIGN.md` patterns; new controls are `DESIGN-GAP`-marked shells for a later impeccable pass).

**Branch:** `item-lifecycle-actions`, branched off `main` (the youtube-ytdlp worktree branch is already merged via PR #20).

---

## 9. Flagged divergences from the main spec (pre-existing, not introduced here)

1. **Cluster FK absent.** `event_clusters.canonical_item` has no `references items(id) on delete set null` despite main spec §355. This feature compensates in `deleteItem` (§5). Recommend (separate task) either adding the FK in a migration or updating §355 to match reality.
2. **CSRF unimplemented.** main spec §748 requires cookie/header CSRF on POST/PUT/DELETE; existing routes (e.g. paste) guard only via `requireApiAuth()`. New routes follow the existing pattern for consistency; closing the CSRF gap is a cross-cutting task, not part of this feature.
