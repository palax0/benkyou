# Scrape-source credentials (YouTube PoToken + Bilibili SESSDATA) & YouTube Whisper fallback

**Date:** 2026-06-22
**Status:** Design (brainstormed, approved section-by-section)
**Supersedes/amends:** M2a credential decisions (`2026-06-14-benkyou-m2a-design.md` §2 "no credentials stored anywhere"); main spec ordering (`2026-05-27-benkyou-design.md` §6.2 + milestone table — see §8 below).

---

## 0. Problem & evidence

A pasted YouTube video (`watch?v=7qO8-kx3gW8`, 1951s) finished as `state=done` with **no transcript**. Investigation (systematic-debugging, 2026-06-22) established two layered facts:

1. **Structural:** YouTube items can never reach the Whisper `transcribe` path. `extract.ts:isTranscribeEligible` gates on `media_url != null`; the YouTube adapter never produces a `media_url` (only direct-media paste and podcast `<enclosure>` do). M2b deliberately scoped Whisper to media_url-bearing items (`2026-06-20-benkyou-m2b-transcription.md:5`, `:1718`).

2. **The real gate is anti-bot, not the missing Whisper wiring.** Live probe (no PoToken) of that video:
   - `playability=OK`, `duration=1951` (metadata fetch works)
   - captions **exist**: `[zh-Hans, zh-Hant]`
   - `get_transcript` → **HTTP 400** (caption fetch blocked)
   - audio stream → **`No valid URL to decipher`** (stream URL withheld)
   - alternate InnerTube clients (ANDROID/IOS/TV/MWEB/WEB_EMBEDDED) all fail to init without attestation/PoToken — **no free bypass**.

**Key correction to the M2a assumption** ("subtitle unreachable → audio transcription will cover it later"): subtitle-block and audio-block are the **same failure domain**. When captions are anti-bot-blocked, the audio stream URL is withheld by the same mechanism. Whisper is therefore **not** a fallback for anti-bot-blocked YouTube — both paths require a PoToken first. And once PoToken is solved, the *cheap* caption path works directly for videos that have captions (zero audio download, zero Whisper minutes); Whisper becomes the narrow fallback for genuinely caption-less videos.

---

## Goal

A **unified per-platform credential model** for scrape sources, that:
- obtains an **anonymous** YouTube PoToken via a self-hosted sidecar, unblocking both caption fetch and audio-stream download;
- lets the user supply a Bilibili `SESSDATA` via an in-browser **QR login flow**;
- wires **YouTube no-caption videos into the existing Whisper `transcribe` chain** (Layer 2), resolving the ephemeral audio URL at download time.

## Non-goals (this round)

- YouTube **logged-in** sessions (members-only / age-restricted content) — anonymous PoToken only; OAuth/device-code login is a future extension slot.
- Bilibili **password login** — captcha-gated (geetest), fragile, handles real password. QR login is the official captcha-free path and strictly better. Explicitly not built.
- **Embedded login iframe** reading cross-origin cookies — impossible by browser security (httpOnly cookies on `bilibili.com`/`youtube.com` are unreadable from the Benkyou origin). This is *why* QR/device flows exist.
- **Browser extension** to lift an existing session — project non-goal (main spec §3.4).
- serverless transcription — unchanged (`skipped_serverless`).

---

## §1. Unified credential model & storage

Two credential kinds, fundamentally different:

| Platform | Credential | Origin | Stored |
|---|---|---|---|
| Bilibili | `SESSDATA` cookie | user (QR login) | persisted, user-visible status |
| YouTube | PoToken + visitor_data | **machine-generated** (sidecar) | cached, not user input |

**Decision — YouTube uses anonymous PoToken, no Google account cookie.** Anonymous PoToken (visitor_data-based, no login) covers all public videos. Storing Google account cookies would expose the full account to the self-hosted process; risk/benefit not worth it. Members/age-restricted videos remain a future optional extension.

**Storage — new table `platform_credentials`** (does not pollute single-row `user_settings` semantics):

```
platform_credentials(
  platform    text primary key,   -- 'youtube' | 'bilibili'
  secret      text,               -- Bili: SESSDATA (user); YT: cached po_token
  meta        jsonb,              -- YT: { visitor_data, ... }; Bili: { expires_at?, ... }
  updated_at  timestamptz not null default now()
)
```

Adding a third platform later = one more row, no schema change. Per-platform is structural, not column-sprawl.

---

## §2. PoToken sidecar architecture & lifecycle

```
worker ──HTTP──> potoken-provider (docker-compose sidecar)
  1. worker builds a no-player Innertube session → obtains visitor_data
  2. POSTs visitor_data to sidecar; sidecar runs BotGuard → returns po_token
  3. worker builds the real Innertube with { po_token, visitor_data }
  4. token cached in platform_credentials (TTL)
  5. on 400/403 or TTL expiry → regenerate once (self-heal); persistent failure → degrade
```

- **Image:** a mature pinned PoToken-provider image (e.g. a `bgutil-*-pot-provider`-class image). Anti-bot churn is absorbed by bumping the image tag — **no Benkyou code change**.
- **docker-mode only:** serverless does not transcribe and tolerates caption degradation. In compose, sidecar shares the worker network, reached by service name, **no published port**.
- **Config:** `POTOKEN_PROVIDER_URL` env var. **Unset = capability off** → YouTube falls back to current "can't fetch → unavailable" behavior (graceful, no error).

---

## §3. Caption path: wiring credentials into adapters

The Innertube session must be built **with** the PoToken — today `youtube.ts` is a bare lazy singleton (`getInnertube()` + `retrieve_player:true`) with no token concept.

- **New module `packages/core/src/sources/youtube-session.ts`** — owns `{Innertube, po_token, visitor_data}`: fetch token from `POTOKEN_PROVIDER_URL`, cache in `platform_credentials` (TTL), build Innertube with `{po_token, visitor_data}`. `fetchYoutubeSubtitle` uses this instead of the bare singleton.
- **Expiry self-heal:** `get_transcript` 400 / playability errors that smell like token expiry → trigger **one** token refresh + retry; only then degrade per the existing contract.
- **Bilibili (`bilibili.ts`):** read SESSDATA from `platform_credentials`, attach as cookie to subtitle-API requests (existing wbi signing untouched). `-101`/not-logged-in → degrade.
- **Credential injection:** follow the existing `reader`-config pattern — extract reads `platform_credentials` and passes via `adapter.extract({…, credentials})`; adapters never touch the DB directly.

**M2a degrade contract preserved (hard invariant):** any definitive failure → `transcript_status='unavailable'` + continue, **never throw to fail the item**. Missing/invalid credential = definitive = degrade. Only genuine transient (network/5xx) throws → pg-boss retry.

---

## §4. YouTube → Whisper audio fallback (Layer 2)

**Technical reality:** YouTube audio-stream URLs are **ephemeral** (googlevideo URLs expire in hours, IP-bound). They must **not** be stored as a durable `media_url` and downloaded later — by job-run time (and across retries) they are likely dead.

**Decision — YouTube stores no `media_url`; the audio-stream URL is resolved fresh at download time.** This matches the main spec's `media_url ?? url` intent (`:261`): for YouTube `media_url` is null, fall back to `url` (the watch URL), and the download stage's resolver turns it into a fresh audio-only stream.

Wiring:

1. **`isTranscribeEligible` stays unchanged — it is the *pre-adapter* gate and must keep matching `media_url`-bearing items only** (`contentType∈{audio,video}` && `media_url != null` && `transcriptStatus≠present`). It deliberately short-circuits the adapter (`extract.ts:97`, "SKIP the adapter entirely"). **Do not widen it to YouTube:** a pasted YouTube URL already carries `contentType='video'` (`paste.ts:initialContentType`), so a widened predicate would fire *before* the adapter runs — caption fetch is skipped (defeating §0's "cheap captions first, Whisper as the narrow fallback") **and** `runMediaHandoff` would see `video_duration=null` and `ffprobe` the watch-page HTML → fail. The Layer-2 seam is therefore *post*-adapter, not a tweak to this gate.
2. **New *post-adapter* handoff branch in `extractItem`** (the actual Layer-2 seam): after `adapter.extract()` returns and its columns are written, if `contentType='video'` && `transcriptStatus='unavailable'` && the item is a YouTube URL && PoToken capability on && `video_duration != null` → hand off to `transcribePolicy` (skip/confirm/transcribe by duration). The adapter's `getInfo` already populated `video_duration` — it resolves even for anti-bot-blocked videos (§0: `playability=OK, duration=1951`) — so the handoff runs on the **known** duration. The `video_duration != null` guard is load-bearing: a no-duration result keeps degrading to `unavailable` and never enters the handoff, which is what prevents the watch-URL `ffprobe` footgun. `transcribePolicy` itself is **unchanged**; reuse `runMediaHandoff` only with the duration pre-resolved (skip its internal `probeRemoteDurationSec`), or call `transcribePolicy` + `enqueueTranscribe` directly. `extractItem` now returns this branch's `StageOutcome` (was `void`), overwriting the just-written `unavailable` with `pending`/`needs_confirmation`/`skipped_*`.
3. **Download-stage resolver:** if the item is YouTube, call `youtube-session` to resolve a fresh audio-only stream URL (decipher) → existing guarded streaming download → chunked Whisper → `transcript_segments` (same contract). **Degrade path:** a definitive resolve failure here (no audio format / undecipherable stream — typically a stale or blocked PoToken) is *not* an immediate degrade. `withYoutubeSession` first attempts one in-session token refresh; if that still fails it throws, and — like every transcribe-stage failure — pg-boss retries then the dead-letter `onFail` degrades the item to `unavailable`. The "definitive → never throw" rule is enforced at the **caption** layer (step 2 / `fetchYoutubeSubtitle`), not at this resolver.
4. **SSRF guard caveat:** recent commits added redirect-hop SSRF re-validation + private-IP blocking to media download. googlevideo is a public host (fine), but Range requests + its redirects must not be killed by the new guards — **implementation must verify** this.

serverless boundary unchanged (`skipped_serverless`).

---

## §5. Failure/degrade & observability

Degrade layering (none break the M2a "never fail item" contract):

| Failure | Behavior |
|---|---|
| `POTOKEN_PROVIDER_URL` unset | YouTube PoToken capability off; current "can't fetch → unavailable"; no error |
| sidecar unreachable / generation fails | refresh fails → that video degrades unavailable; **counted in health panel** |
| Bili SESSDATA missing/expired/`-101` | degrade unavailable |
| genuine transient (network/5xx) | throw → pg-boss retry (contract unchanged) |

Observability (reuse existing M1c/M2a panels, no new system):

- **Credential status on settings page:** Bili SESSDATA shows valid/expired/unset (SESSDATA expires in months; user needs to know when to re-scan). YouTube PoToken auto-refreshes; alarm only on **persistent** sidecar failure — normal state needs no user attention.
- **Sidecar health into the health panel:** a dead sidecar causes clustered YouTube degradation — this must be visible (cf. source `consecutive_failures`), else it becomes a silent failure (the `extract-cloudflare` trap).
- **Degrade-reason distinction (lightweight):** keep `youtube.ts`'s existing `console.warn` reason logging (no-captions vs blocked vs token-expired). **No** new `transcript_status` enum value (schema churn not worth it) — with Layer 2 on, "blocked-but-has-captions" proceeds to Whisper anyway, so the cases converge.

---

## §6. Testing strategy

Follows existing conventions (Testcontainers for DB integration, MSW for HTTP mocking, live tests off by default).

- **Pure-function TDD:** credential resolution, the post-adapter YouTube→Whisper handoff predicate (`§4.2`: video && unavailable && YouTube && PoToken-on && duration!=null), token-expiry detection. (`isTranscribeEligible` is *unchanged* — its existing tests stand.)
- **`youtube-session`:** mock sidecar HTTP + Innertube — refresh-once-on-expiry, TTL cache hit, sidecar-down → degrade.
- **Bili QR state machine:** mock Bili responses — not-scanned / scanned-pending / success / timeout polling + SESSDATA extraction → store.
- **Layer 2 routing:** assert the post-adapter branch fires — a YouTube `unavailable` result with a known `video_duration` enqueues `transcribe` (and a `video_duration=null` result does **not**, degrading to `unavailable`); plus mock resolver (youtube url → audio stream). transcribe chain itself already covered.
- **Step 0 spike = first gate** (see §7), formalized as a gated live test against the known-blocked 7qO8 video.
- **No TDD for:** sidecar image selection, compose config, migration.

---

## §7. Step 0 spike (load-bearing assumption — MUST run first)

The whole design rests on: *with a PoToken, both `get_transcript` and the audio stream unblock.* We have proven only the **negative** (without PoToken both fail). The `get_transcript` 400 could conceivably be a youtubei.js v17 API-drift bug independent of PoToken.

**Before building the credential model**, stand up the sidecar, generate one anonymous PoToken, and prove against the known-blocked 7qO8 video that it unblocks (a) caption fetch and (b) audio-stream download. If the spike fails for captions, the 400 is a different problem — stop and re-diagnose before investing in the full model.

---

## §8. Main-spec ordering correction (task b)

The main spec presents Whisper as the resolution for no-subtitle scrape videos, and places the credential/PoToken model *after* M2b:

- §6.2 `:458` — "视频无字幕 … 转写决策" implies no-subtitle videos flow to transcription.
- milestone table `:948` — "无字幕视频 M2a 暂以 unavailable 继续(M2b 转正，不回填)".
- but M2b plan (`:5`,`:1718`) delivered Whisper only for media_url-bearing items; YouTube/Bili stay caption-only.

The evidence in §0 shows the ordering is inverted: **PoToken/credentials are a shared prerequisite for both caption fetch AND audio transcription on scrape sources.** Whisper is not a workaround for the anti-bot wall.

**Edit to apply** (separate small commit, see task b): annotate §6.2 + the milestone table to state that scrape-source (YouTube/Bilibili) transcription — captions *and* Whisper — is gated on this credential/PoToken work, and that M2b's Whisper covered only media_url-bearing items (direct-media paste, podcast enclosure).

---

## Open risks

- **§7 spike outcome** — if PoToken doesn't unblock `get_transcript`, the caption layer needs a different fix (library bump / endpoint change).
- **Sidecar image longevity** — anti-bot churn may break the chosen provider image; mitigation is pin-and-bump, but a dead upstream is a real maintenance risk for a solo self-hoster.
- **SSRF guard vs googlevideo Range/redirects** (§4.4) — must be verified, not assumed.
- **Ephemeral-URL race** — even resolved-at-download-time, a long Whisper job could outlive the stream URL; chunked download must complete within the URL's validity window (or re-resolve per chunk).
