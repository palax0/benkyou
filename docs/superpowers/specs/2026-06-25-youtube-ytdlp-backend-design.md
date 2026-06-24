# YouTube backend migration: youtubei.js + PoToken → yt-dlp subprocess

**Date:** 2026-06-25
**Status:** Design (brainstormed, approved section-by-section)
**Supersedes/amends:**
- `2026-06-22-scrape-source-credentials-design.md` §2/§3/§4/§7 **for YouTube** (its `§7` spike came back negative — see §0). Its **Bilibili SESSDATA** half is unaffected.
- Main spec `2026-05-27-benkyou-design.md` §4 / §6.2 + milestone table — the "resolve a fresh audio URL → hand the URL to Whisper" model does not hold under SABR (§4 below).

---

## §0. Problem & evidence

The `2026-06-22` credential design rests on one load-bearing assumption, formalized as its own `§7 "Step 0 spike (MUST run first)"`:

> *With a PoToken, both `get_transcript` and the audio stream unblock.*

That spike was run on **2026-06-25** against the known-blocked video `https://www.youtube.com/watch?v=7qO8-kx3gW8` (1951s), with the sidecar **online** (bgutil-class provider `v1.1.0`) and a **valid** PoToken (metadata fetch proves the token works). It came back **negative on every path that matters**:

| Path | Result | Nature |
|---|---|---|
| `getInfo` / playability / caption-track enumeration | ✅ OK (PoToken valid) | metadata only |
| captions `info.getTranscript()` | ❌ 400 `FAILED_PRECONDITION` | **endpoint 100% blocked, token-independent.** Upstream-confirmed: `LuanRT/YouTube.js#1102` |
| captions `caption_tracks[].base_url` (timedtext) | ❌ 429 Google "automated queries" | IP-reputation block, IP-dependent |
| audio stream URL (`chooseFormat().decipher()`) | ❌ "No valid URL to decipher" | `server_abr_streaming_url` set = **SABR**; formats carry no `url`/`cipher`, IP-independent |

**Conclusions:**

1. **The caption path through youtubei.js is permanently dead** (400 `FAILED_PRECONDITION`), independent of PoToken or IP. This is not a tuning problem.
2. **Whisper cannot be the fallback either:** under SABR there is **no audio URL to decipher** — `resolveYoutubeAudioUrl` (which walks the WEB client's `decipher()`) has nothing to return. Captions and audio are the **same dead delivery mechanism**, not two independent failure domains with Whisper backstopping captions.
3. This invalidates `2026-06-22` §4's core wiring ("resolve a fresh ephemeral audio URL at download time → hand the URL to the Whisper endpoint"). There is no URL to hand over.

**Decision (approved with the user):** migrate YouTube caption + audio acquisition to **yt-dlp**. The yt-dlp team chases SABR / pot / client rotation full-time; tracking that cat-and-mouse inside youtubei.js by hand is a losing maintenance proposition.

---

## §1. Scope of the migration — full retirement

yt-dlp takes over the **entire** YouTube extraction surface: metadata (title, duration) **and** captions **and** audio. **youtubei.js retires for YouTube.**

Rejected alternative — "yt-dlp for captions+audio only, keep youtubei.js for metadata": metadata is the one path that still works, but yt-dlp returns title+duration for free in the same `-J` call that resolves captions, so keeping youtubei.js for metadata would buy nothing while forcing us to keep the PoToken sidecar, our hand-rolled token lifecycle, and a second cat-and-mouse game. A half-migration keeps us chasing youtubei.js. Full retirement is the point.

**Consequences (all confirmed against the code):**

- **Delete `packages/core/src/sources/youtube-session.ts`** — `withYoutubeSession`, the token TTL/cache lifecycle, `singleFlight`, `YoutubeTokenExpiryError`, `isYoutubeTokenExpiryError`, `resolveYoutubeAudioUrl`, `isPotokenEnabled`, `INNERTUBE_OPTIONS` consumer.
- **Shrink `packages/core/src/sources/potoken-client.ts`** — delete `fetchAnonymousPoToken` (the `/get_pot` client; yt-dlp's pot plugin now owns token fetch). **Keep `pingPotokenSidecar`** (the generic `/ping` health check used by `pipeline/status.ts`) — relocate it (e.g. into `ytdlp.ts` or a small `potoken-health.ts`) so the health surface survives even after the client logic goes.
- **Drop the `youtubei.js` dependency** from `packages/core/package.json` — after this change only `youtube.ts`/`youtube-session.ts` imported it; Bilibili has its own client.
- **No DB schema change.** The `platform_credentials` `youtube` row (cached `po_token` + `visitor_data`) simply goes unused; yt-dlp's pot plugin manages pot. We stop writing it. Bilibili's row is untouched.

---

## §2. Integration form — worker subprocess

yt-dlp runs as a **subprocess inside the worker**, not as a BYO HTTP service.

Rationale (and pushback on the BYO framing): the reader/Whisper BYO pattern exists because those are *inference* services with a real SaaS market (Deepgram, OpenAI) and GPU weight. yt-dlp is a ~30 MB Python CLI with **no SaaS to BYO to** — a "BYO yt-dlp service" means the self-hoster builds and maintains a *second custom container*, i.e. strictly **more** burden. And under SABR we need the audio **bytes**, not a URL: a subprocess keeps bytes on local disk (the worker already has `ffmpeg` + `downloadToTmp` + tmp), whereas an HTTP service would force a fat audio payload across a service boundary. The BYO-HTTP intuition is inherited from the now-dead URL-handoff model.

**Docker image (`Dockerfile.worker`):** add `python3` and `yt-dlp` (and the pot-provider plugin if §6 spike requires it) to the existing `apk add ffmpeg` layer. Pinned versions; **bump-on-break** — same maintenance model as the sidecar image, no Benkyou code change to absorb YouTube churn.

**Invocation safety:** spawn with an **arg array, never a shell**; pass the canonical watch URL we reconstruct from the **parsed `videoId`** (`parseYoutubeVideoId`), never the raw user-pasted string. This matches the existing `spawn('ffmpeg', args)` pattern in `transcribe.ts`.

**Serverless:** YouTube degrades to `unavailable` + continue, same end-state as today. One **named consequence** of full retirement: today serverless still extracts metadata (title/duration) via the pure-JS youtubei.js path even without a token; removing youtubei.js means serverless YouTube items get **no metadata either** (they continue on the pasted URL as title, `contentType='video'`, `transcript_status='unavailable'`). This is an accepted minor degradation — serverless is the secondary mode and already does not transcribe; reintroducing youtubei.js solely for serverless metadata would resurrect the dependency we are deleting. The degrade is enforced by a **binding gate, not best-effort** — see §5.

---

## §3. Module shape — reuse the existing seam

`youtube.ts` already defines the contract `FetchYoutubeSubtitle = (videoId) => Promise<RawSubtitleTrack | null>` and an adapter built around it (`createYoutubeAdapter`). We **keep the adapter shell** and swap only the implementation behind that seam.

```
NEW  sources/ytdlp.ts                       subprocess wrapper + PURE parsers
       buildYtdlpArgs(videoId, opts)        pure → string[] (no shell)
       parseJson3Cues(json)                 pure → RawCue[]
       selectCaptionTrack(info, prefs)      pure → manual → auto → none
       classifyYtdlpError(code, stderr)     pure → 'definitive' | 'transient'
       fetchYoutubeTrack(videoId, run?)     GATE: !isYoutubeBackendEnabled() → degrade, NO spawn
                                            else spawns: -J + json3 → RawSubtitleTrack
       downloadYoutubeAudio(videoId, run?)  spawns: -f bestaudio → { path, cleanup }
                                            (only reached post-gate via the Layer-2 handoff)

MOD  sources/youtube.ts        fetchYoutubeSubtitle delegates to ytdlp; isDefinitiveYoutubeError
                               re-expressed via classifyYtdlpError; drop youtubei.js imports.
                               KEEP: createYoutubeAdapter, cuesToSegments, unavailable,
                                     parseYoutubeVideoId, isYoutubeWhisperHandoff.
MOD  pipeline/transcribe.ts    YouTube branch calls downloadYoutubeAudio() instead of
                               resolveDownloadSource()+downloadToTmp(); then the EXISTING
                               planChunks → ffmpegSliceToOgg → Whisper chain, unchanged.
MOD  pipeline/extract.ts       isPotokenEnabled() → isYoutubeBackendEnabled() (§5 gate).
DEL  sources/youtube-session.ts
DEL  sources/potoken-client.ts:fetchAnonymousPoToken (keep+relocate pingPotokenSidecar)
DEP  packages/core: remove youtubei.js
```

**Dependency injection for testability:** the two spawn-running functions accept an injectable `run` dependency (mirroring the existing `SessionDeps` DI in `youtube-session.ts`). Pure functions (`parseJson3Cues`, `classifyYtdlpError`, `selectCaptionTrack`, `buildYtdlpArgs`) carry the logic and are unit-tested without a real subprocess.

---

## §4. Two flows

### §4.1 Captions (cheap path — fires first via the unchanged adapter)

```
yt-dlp -J --skip-download            → title, duration, subtitle availability map
  manual subs present?  → download json3 → parseJson3Cues → transcript_status='present'
  auto subs present?    → download json3 → parseJson3Cues → transcript_status='present'   (DECISION below)
  neither?              → empty cues → 'unavailable' → Layer-2 Whisper handoff (§4.2)
```

**Decision — accept auto-generated (Google ASR) captions as `present`.** Preference order: manual → auto → none. Rationale: matches the cheap-captions-first principle (`2026-06-22` §0); for embed/score/summary, ASR captions are good enough, and Whisper is *also* ASR so the quality gain from rejecting auto-captions is modest while the cost (audio download + Whisper minutes) is real. Whisper becomes the **narrow** fallback for genuinely caption-less videos only.

**json3 parsing:** json3 `events[].segs[].utf8` joined per event; `start = tStartMs/1000`, `end = (tStartMs + dDurationMs)/1000`; drop empty/whitespace cues. Output is the existing `RawCue { start, end, text }` contract → `cuesToSegments` → `transcript_segments`, unchanged downstream. (`speaker` stays unset — caption tracks carry no diarization; only Whisper/Deepgram fills it.)

**Worked example:** the §0 test video `7qO8` has `[zh-Hans, zh-Hant]` caption tracks → it resolves on the **caption** path (`present`), never downloads audio, never enters Whisper, and never parks at `needs_confirmation`. The `transcribe-policy` 1951s > 1800s `autoLimit` gate is now only reachable for genuinely caption-less videos.

### §4.2 Audio / Whisper fallback (SABR byte path)

Under SABR there is **no audio URL** — `resolveYoutubeAudioUrl` is deleted. The Layer-2 seam (the *post-adapter* `isYoutubeWhisperHandoff` branch in `extractItem`) is **unchanged** in shape: `contentType='video'` && `transcriptStatus='unavailable'` && YouTube URL && backend-enabled && `video_duration != null` → `applyTranscribePolicy(duration)`. The `video_duration` is now populated by yt-dlp `-J` (resolves even for caption-less videos), so the handoff still runs on a **known** duration and the `video_duration != null` guard remains load-bearing (prevents the watch-page `ffprobe` footgun).

The change is only in **download resolution** inside `transcribe.ts`: for a YouTube item, call `downloadYoutubeAudio(videoId)` → `{ path, cleanup }` (yt-dlp fetches `bestaudio` to worker tmp) instead of `resolveDownloadSource()` + `downloadToTmp()`. From there the **existing** chain is untouched: `planChunks` → `ffmpegSliceToOgg` (already extracts/transcodes audio) → concurrent Whisper (`p-limit` 3) → `mergeSegments`. Duration comes from `item.durationSec` (already known from extract) ?? yt-dlp metadata.

The transcribe stage's existing degrade-on-failure contract is preserved (per `2026-06-20` M2b: a failed transcribe → `transcript_status='unavailable'` + pipeline continues, never `failed`; `retryLimit=2`, per-job `transcribeBudgetSec`).

---

## §5. Capability gate + sidecar fate

`isPotokenEnabled()` (= `POTOKEN_PROVIDER_URL` set) is replaced by **`isYoutubeBackendEnabled()`**. Its exact predicate is **decided by the §6 spike**:

- **If yt-dlp needs the pot provider for our (public, anonymous) videos:** keep the sidecar; flip its consumer from our `fetchAnonymousPoToken` to yt-dlp's `bgutil-ytdlp-pot-provider` **plugin** (installed in the worker image, configured to reach the sidecar). Gate = `docker mode && POTOKEN_PROVIDER_URL set`.
- **If yt-dlp works without the pot provider:** **drop the sidecar entirely** (remove the compose service + `POTOKEN_PROVIDER_URL`). Gate = `docker mode` (subprocess available).

**Per the user, the sidecar drop is left as a spike outcome, not decided now.**

**Binding requirement — the gate guards BOTH consumers, not just Layer-2.** Full retirement moves *metadata and captions* onto the subprocess too, so the gate must short-circuit the **caption path** as well, otherwise the serverless `/api/cron/work` extract queue would attempt a subprocess that cannot run:

- **`fetchYoutubeTrack` (caption path):** first line is `if (!isYoutubeBackendEnabled()) return <degraded RawSubtitleTrack: empty cues, null duration/title>;` — **no spawn**. The adapter then degrades to `unavailable` + continue per the M2a contract.
- **`extractItem` Layer-2 gate (`isYoutubeWhisperHandoff`):** unchanged — already gated on this capability; audio download never reached when off.

This is a **hard gate, not best-effort.** Required test: with the backend disabled (serverless / unset), `fetchYoutubeTrack` returns a degraded track **without invoking the injected `run`** (assert the subprocess runner is never called), and `extractItem` produces `transcript_status='unavailable'` + advance. Both gate branches keep serverless = off.

---

## §6. Spike-first gate (do NOT repeat §0's mistake)

The `2026-06-22` design failed in production precisely because its load-bearing assumption (§7) was never validated before building. **Task 1 of the implementation plan is a gated live spike** (`YTDLP_LIVE=1` against `7qO8`, the known-blocked video), before any production code. Run **each probe in both sidecar configurations** (with the pot provider, without it) and record the full matrix:

| # | Probe | with sidecar | without sidecar |
|---|---|---|---|
| 1 | `yt-dlp -J` → `title` + `duration` | record pass/fail | record pass/fail |
| 2 | json3 captions download (`zh-Hans`) | record pass/fail | record pass/fail |
| 3 | `yt-dlp -f bestaudio` → playable audio | record pass/fail | record pass/fail |

**Pass/fail conditions are hard gates, not advisory:**

- **Probe 2 (captions) must pass in at least one configuration** — else the migration premise is dead for captions: **STOP and re-diagnose**, do not build.
- **Probe 1 (metadata) must pass in the chosen configuration** — `video_duration` feeds the Layer-2 gate and `title` refines the item; if captions pass, metadata effectively must too, but assert it.
- **Probe 3 (audio) is a hard gate for the Whisper fallback, not advisory.** It is the load-bearing proof for caption-less videos. If captions+metadata pass but audio fails: do **not** stop the migration — instead **explicitly descope to caption-only this round**: the no-caption → Whisper path for YouTube is dropped, caption-less YouTube videos degrade to `unavailable` + continue (same as a no-caption Bilibili), and §4.2 + the Layer-2 handoff are deferred to a follow-up. Record this as an explicit decision, not a silent gap.
- **Sidecar decision (settles §5):** the **minimal configuration that passes all required gates wins.** If the *without-sidecar* column passes captions+metadata(+audio), **drop the sidecar**; otherwise keep it and wire the pot plugin.

The spike's recorded matrix + the descope/sidecar decisions are a written output of Task 1, gating every subsequent task.

---

## §7. Error classification (replaces token-expiry "smells")

yt-dlp + its pot plugin own pot rotation internally, so failures surfacing to us are no longer "token-expiry smells."

**The two consuming stages have OPPOSITE terminal semantics — this is the crux** (verified in `queue/runner.ts`):

| Stage | On exhausted retries (`onFail`) | Therefore a thrown error eventually becomes |
|---|---|---|
| **extract** (caption path) | `handleDeadLetter` → `markFailed` (`runner.ts:50`) | **`state='failed'`** |
| **transcribe** (audio path) | `handleTranscribeDeadLetter` → `degradeTranscriptAndAdvance` (`runner.ts:70`) | **`unavailable` + continue** |

So "throw → retry → degrade" holds **only for the audio path**. On the **caption path, throw → retry → `failed`.** A naïve "429/bot = transient" therefore *fails* the item — violating the M2a "never fail on a scrape block" invariant. The fix is to classify by **desired terminal outcome**, mapped per stage.

`classifyYtdlpError(exitCode, stderr) → 'transient' | 'definitive'`:

- **`transient`** = genuine infrastructure only: DNS / connection reset / timeout / 5xx / "Unable to download webpage" from a network cause.
- **`definitive`** = everything that won't clear by an immediate same-IP retry:
  - content-unavailability — "Private video", "Video unavailable", "has been removed", "members-only", "Sign in to confirm your age", geo-block;
  - **anti-bot — 429 "automated queries" and bot/attestation failures.** (Moved here from "transient." A same-IP retry inside the backoff window almost never clears a 429, and yt-dlp+plugin already retried pot internally before surfacing the error — so external retry is near-zero value and only risks `failed`.)
- **unknown nonzero exit → `definitive`** (default). Safer on the caption path: degrade-and-continue rather than risk `failed`.

**Per-stage mapping:**

- **Caption layer (`fetchYoutubeTrack` / adapter):** `definitive` → return empty-cue track → `unavailable` + continue, **never throw**. `transient` → throw `TransientFetchError` → pg-boss retry → (genuine infra still down at exhaustion → `failed`, which is the *correct* signal for a real outage and is unchanged M2a behavior).
- **Audio layer (`downloadYoutubeAudio` / transcribe):** any yt-dlp failure → throw; transcribe's `onFail` degrades to `unavailable` regardless (M2b). The `definitive`/`transient` split is immaterial here because the terminal is already degrade; we deliberately do **not** add an immediate-degrade short-circuit (it would only save at most `retryLimit=2` retries — not worth the special case).

**Deliberate call (revised from the draft):** 429 / bot-detection are **definitive at the caption layer** — degrade immediately, do not retry. Rationale: the extract terminal is `markFailed`, and a same-IP retry cannot clear an IP-reputation 429. This is faithful to the pre-migration behavior, where `isYoutubeTokenExpiryError` degraded (returned the partial track) rather than failing the item. Only genuine network/5xx throws — its eventual `failed`-on-exhaustion is the correct surfacing of a real outage.

The M2a **hard invariant is preserved**: on the caption path, only a genuine transient ever throws; every block (content or anti-bot) degrades to `unavailable` + continue.

---

## §8. Observability & UI surface

- **Sidecar health survives if the sidecar survives.** `pipeline/status.ts:getPotokenHealth` (→ `/admin/jobs`) keeps pinging via the relocated `pingPotokenSidecar`. If the §6 spike drops the sidecar, this health row is removed instead.
- **`credential-status.ts` YouTube row** is already capability-only (`'off' | 'auto'` from `POTOKEN_PROVIDER_URL` presence) — no stored-token semantics to unwind. It stays as-is if the sidecar stays; if dropped, it reflects `docker` capability instead.
- **Degrade-reason logging:** keep `youtube.ts`'s existing `console.warn` reason logging (no-captions vs blocked vs error), now sourced from yt-dlp stderr. **No new `transcript_status` enum value** (schema churn not worth it; cases converge as in `2026-06-22` §5).

---

## §9. Testing strategy

Follows existing conventions (Testcontainers for DB integration, live tests off by default; subprocess mocked via injected `run`, not MSW — it's `spawn`, not HTTP).

- **Pure-function TDD:** `parseJson3Cues` (json3 → cues, incl. multi-seg events, empty-cue filtering, missing fields), `classifyYtdlpError` — explicit matrix asserting **429 & bot/attestation → `definitive`**, private/removed/geo/age → `definitive`, network/5xx/timeout → `transient`, unknown-exit → `definitive`; `selectCaptionTrack` (manual-preferred → auto-fallback → none), `buildYtdlpArgs` (videoId → canonical URL, no shell injection, pot args when enabled).
- **Per-stage terminal mapping (the §7 crux):** caption layer — a `definitive` (incl. 429/bot) result degrades to `unavailable` + continue and **does not throw** (assert the item never reaches `failed`); a `transient` result throws `TransientFetchError`. This is the regression guard against re-failing items on anti-bot blocks.
- **Backend-off gate (§5, binding):** with `isYoutubeBackendEnabled()` false, `fetchYoutubeTrack` returns a degraded track **without invoking the injected `run`** (assert the runner is never called) → adapter yields `unavailable`; serverless extract never spawns.
- **Subprocess wrappers:** inject a fake `run` → assert arg construction, stdout-JSON parse, exit-code → classification, tmp cleanup.
- **Unchanged predicates retested under new names:** `isYoutubeWhisperHandoff` (video && unavailable && YouTube && backend-on && duration != null), `transcribe-policy` branches. Their existing tests stand.
- **`transcribe.ts` YouTube branch:** mock `downloadYoutubeAudio` (videoId → tmp path) → asserts it bypasses `downloadToTmp`/`probeRemoteDurationSec` and feeds the existing chunk chain.
- **§6 live spike:** gated `YTDLP_LIVE=1` against `7qO8`, the first gate.
- **No TDD for:** yt-dlp/plugin version selection, Dockerfile, compose changes.

---

## §10. Open risks

- **yt-dlp churn is faster than the sidecar's.** YouTube sometimes breaks yt-dlp within days; a pinned yt-dlp in a rarely-rebuilt image can rot. Mitigation = pin-and-bump + document the bump procedure. **Not** `pip install -U` at container start (breaks reproducibility per CLAUDE.md). This is a genuine solo-maintainer burden, named not solved.
- **Spike could still fail** (§6). If yt-dlp cannot fetch captions/audio for blocked videos either, the migration premise is wrong — the spike is the kill-switch before investment.
- **Sidecar-vs-no-sidecar is unresolved until the spike** (§5) — both code paths must be cheap to switch between; keep `isYoutubeBackendEnabled` the single chokepoint.
- **Ephemeral-URL race is retired** — we download bytes, not a URL; the `2026-06-22` §10 race no longer applies.
- **Large-audio download time** must fit within the transcribe job's `transcribeBudgetSec`; yt-dlp download is sequential before chunking. Long videos already hit the duration policy gates first.
