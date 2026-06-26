# YouTube backend migration (youtubei.js → yt-dlp subprocess) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the youtubei.js + PoToken YouTube backend with a yt-dlp subprocess that owns the entire YouTube extraction surface (metadata + captions + audio), behind the existing `FetchYoutubeSubtitle` adapter seam.

**Architecture:** A new `sources/ytdlp.ts` module holds pure parsers (`parseJson3Cues`, `classifyYtdlpError`, `selectCaptionTrack`, `buildYtdlpArgs`) plus two subprocess wrappers (`fetchYoutubeTrack`, `downloadYoutubeAudio`) that accept an injectable `run` dependency for testability. `youtube.ts` keeps its adapter shell and delegates to the new module. `youtube-session.ts` and the PoToken client are retired. A single capability chokepoint `isYoutubeBackendEnabled()` gates **both** the caption and audio paths so serverless degrades cleanly.

**Tech Stack:** TypeScript 5.7 strict, Node 22, `node:child_process` spawn (arg array, never shell), yt-dlp (Python CLI in the worker Docker image), Vitest 4. Subprocess mocked via injected `run` — **not** MSW (it's `spawn`, not HTTP).

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-06-25-youtube-ytdlp-backend-design.md`) and `CLAUDE.md`. Every task's requirements implicitly include these:

- **Invocation safety:** spawn with an **arg array, never a shell**; pass the canonical watch URL reconstructed from the **parsed, validated `videoId`**, never the raw user-pasted string. (spec §2)
- **The gate guards BOTH consumers.** `isYoutubeBackendEnabled()` must short-circuit the caption path **and** the audio path. When off, `fetchYoutubeTrack` returns a degraded track **without invoking the injected `run`**. This is a **hard gate, not best-effort**. (spec §5)
- **429 / bot-detection are `definitive` at the caption layer** — degrade immediately, never retry (a same-IP retry can't clear an IP-reputation 429; extract's terminal is `markFailed`). (spec §7)
- **The two consuming stages have OPPOSITE terminal semantics:** caption path `throw → retry → failed`; audio path `throw → retry → unavailable+continue`. Classify by **desired terminal outcome**, mapped per stage. (spec §7)
- **No DB schema change. No new `transcript_status` enum value.** The `platform_credentials` `youtube` row simply goes unused; stop writing it. Bilibili untouched. (spec §1, §8)
- **Pin-and-bump for yt-dlp;** never `pip install -U` at container start (breaks reproducibility per CLAUDE.md). (spec §10)
- **TypeScript strict:** no `any` without `// @ts-expect-error` + reason. **Named exports only.** Tests live in `packages/core/test/...` mirroring `src`. Conventional commit prefixes. (CLAUDE.md)
- **Single chokepoint:** keep `isYoutubeBackendEnabled` (and `isYoutubeAudioEnabled`) the only capability predicates — both sidecar-vs-no-sidecar code paths stay cheap to switch between. (spec §10)

---

## Spike-gated decisions (set by Task 1, consumed by later tasks)

Three downstream choices are **deliberately deferred to the Task 1 live spike** (spec §5/§6). Tasks below are written for the **expected full-scope outcome** (captions + metadata + audio all pass; sidecar kept) and carry an explicit **Descope/Drop variant** where they diverge. After Task 1, fill these in:

- **`SIDECAR`** = ~~`keep` |~~ **`drop`** ✅ RESOLVED — without-sidecar passed all three gates, so the minimal column wins. Drives `isYoutubeBackendEnabled` body (Task 6 → **drop form**), the pot extractor-arg (Tasks 5/6 → keep the optional arg code but it's never set in prod), the Dockerfile plugin (Task 14 → **omit bgutil plugin**), and compose (Task 15 → **remove sidecar + `POTOKEN_PROVIDER_URL`**).
- **`AUDIO`** = **`in-scope`** ✅ RESOLVED — Probe 3 (audio) passed. Drives Tasks 8, 11, and the Layer-2 handoff gate (Task 10) → **full-scope variants**.
- **`POT_EXTRACTOR_ARG`** = **N/A** ✅ RESOLVED — `SIDECAR=drop`, so no pot plugin is used. The `buildYtdlpArgs` optional `--extractor-args` path stays (defensive + unit-tested) but is never exercised in production.

> See **`## Task 1 spike result`** at the end of this file for the full matrix and environment.

---

## File Structure

```
NEW  packages/core/src/sources/ytdlp.ts            subprocess wrapper + PURE parsers + gate
NEW  packages/core/src/sources/potoken-health.ts   relocated pingPotokenSidecar (health-only)
NEW  packages/core/test/sources/ytdlp.test.ts      pure-fn + wrapper + gate unit tests
NEW  packages/core/test/sources/ytdlp-spike.int.test.ts   §6 live gate (YTDLP_LIVE=1)
NEW  packages/core/test/sources/potoken-health.test.ts    moved pingPotokenSidecar tests

MOD  packages/core/src/sources/youtube.ts          delegate to ytdlp; drop youtubei.js
MOD  packages/core/src/pipeline/extract.ts         isPotokenEnabled → isYoutubeBackendEnabled
MOD  packages/core/src/pipeline/transcribe.ts      downloadYoutubeAudio for the YouTube branch
MOD  packages/core/src/pipeline/status.ts          import pingPotokenSidecar from potoken-health
MOD  packages/core/package.json                    remove youtubei.js
MOD  packages/core/test/sources/youtube.test.ts    drop INNERTUBE_OPTIONS / isDefinitiveYoutubeError blocks
MOD  packages/core/test/pipeline/extract-youtube-handoff.int.test.ts  drop youtube-session mock
MOD  Dockerfile.worker                             add python3 + yt-dlp (+ pot plugin if SIDECAR=keep)
MOD  docker-compose.yml                            keep or drop potoken-provider per SIDECAR

DEL  packages/core/src/sources/youtube-session.ts
DEL  packages/core/src/sources/potoken-client.ts
DEL  packages/core/test/sources/youtube-session.test.ts
DEL  packages/core/test/sources/potoken-client.test.ts
DEL  packages/core/test/sources/youtube-potoken-spike.int.test.ts
DEL  packages/core/test/sources/youtube-fetch.int.test.ts
DEL  packages/core/test/pipeline/transcribe-youtube-resolve.test.ts
```

---

### Task 1: Live spike — the kill-switch gate (spec §6)

**This runs before any production code.** It validates the migration premise against the known-blocked video and records the `SIDECAR` / `AUDIO` / `POT_EXTRACTOR_ARG` decisions that gate every later task. Do **not** repeat the §0 mistake of building on an unvalidated assumption.

**Prerequisites (local dev box):** `yt-dlp` on PATH (`pipx install yt-dlp` or `pip install yt-dlp`), `python3`, and — for the with-sidecar column — the provider running locally:
```bash
docker compose up -d potoken-provider   # publishes nothing by default; for the spike, temporarily add `ports: ['4416:4416']`
```

**Files:**
- Create: `packages/core/test/sources/ytdlp-spike.int.test.ts`

- [ ] **Step 1: Write the gated spike test**

```typescript
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// §6 SPIKE — the kill-switch. Validates yt-dlp can fetch metadata + captions (+ audio)
// for the known-blocked video BEFORE the migration is built. Off by default.
// Run WITH sidecar (publish 4416 locally first):
//   YTDLP_LIVE=1 POTOKEN_PROVIDER_URL=http://localhost:4416 \
//   pnpm --filter @benkyou/core test ytdlp-spike
// Run WITHOUT sidecar:
//   YTDLP_LIVE=1 pnpm --filter @benkyou/core test ytdlp-spike
const RUN = process.env.YTDLP_LIVE === '1';
const BLOCKED_ID = '7qO8-kx3gW8'; // §0: captions [zh-Hans, zh-Hant], blocked through youtubei.js
const URL = `https://www.youtube.com/watch?v=${BLOCKED_ID}`;
const POT = process.env.POTOKEN_PROVIDER_URL; // set → "with sidecar" column

function runYtdlp(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let stdout = ''; let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

// The pot plugin arg under test. Task 1 confirms the literal key → records POT_EXTRACTOR_ARG.
const potArgs = POT ? ['--extractor-args', `youtubepot-bgutilhttp:base_url=${POT}`] : [];

describe.skipIf(!RUN)('yt-dlp spike (§6 gate)', () => {
  test('Probe 1: metadata (-J) resolves title + duration', async () => {
    const r = await runYtdlp([...potArgs, '--no-playlist', '-J', '--skip-download', URL]);
    expect(r.code).toBe(0);
    const info = JSON.parse(r.stdout) as { title?: string; duration?: number };
    expect(typeof info.title).toBe('string');
    expect(typeof info.duration).toBe('number');
  }, 120_000);

  test('Probe 2: json3 captions (zh-Hans) download and parse', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spike-'));
    try {
      const r = await runYtdlp([
        ...potArgs, '--no-playlist', '--skip-download', '--write-subs', '--write-auto-subs',
        '--sub-langs', 'zh-Hans', '--sub-format', 'json3', '-o', join(dir, 'sub.%(ext)s'), URL,
      ]);
      expect(r.code).toBe(0);
      const files = await readdir(dir);
      const json3 = files.find((f) => f.endsWith('.json3'));
      expect(json3).toBeDefined();
      const parsed = JSON.parse(await readFile(join(dir, json3!), 'utf8')) as { events?: unknown[] };
      expect((parsed.events?.length ?? 0)).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test('Probe 3: bestaudio downloads a playable file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spike-'));
    try {
      const r = await runYtdlp([...potArgs, '--no-playlist', '-f', 'bestaudio', '-o', join(dir, 'audio.%(ext)s'), URL]);
      expect(r.code).toBe(0);
      const files = await readdir(dir);
      expect(files.some((f) => f.startsWith('audio.'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
```

- [ ] **Step 2: Run the spike in BOTH configurations and record the matrix**

```bash
# With sidecar (after temporarily publishing 4416):
YTDLP_LIVE=1 POTOKEN_PROVIDER_URL=http://localhost:4416 pnpm --filter @benkyou/core test ytdlp-spike
# Without sidecar:
YTDLP_LIVE=1 pnpm --filter @benkyou/core test ytdlp-spike
```

Record pass/fail for each probe × each column into the spec §6 matrix (edit the spec file, or a `## Task 1 spike result` block appended to this plan).

- [ ] **Step 3: Apply the hard gates and write the decisions**

Apply spec §6 rules exactly:
- **Probe 2 (captions) fails in BOTH columns → STOP.** The migration premise is dead; do not build. Re-diagnose.
- **Probe 1 (metadata) must pass in the chosen column.**
- **Probe 3 (audio) fails but captions+metadata pass → set `AUDIO=descoped`** (caption-only this round; §4.2 deferred). Do **not** stop.
- **`SIDECAR` = the minimal column that passes all required gates.** If *without-sidecar* passes captions+metadata(+audio), `SIDECAR=drop`; else `keep`.
- If `SIDECAR=keep`, record the exact working `--extractor-args` string as `POT_EXTRACTOR_ARG`.

Write the three decisions (`SIDECAR`, `AUDIO`, `POT_EXTRACTOR_ARG`) into the spec/plan. **They gate every subsequent task.**

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/sources/ytdlp-spike.int.test.ts docs/superpowers/
git commit -m "test(youtube): gated yt-dlp live spike + recorded §6 decision matrix"
```

---

### Task 2: Pure parser — `parseJson3Cues`

**Files:**
- Create: `packages/core/src/sources/ytdlp.ts`
- Test: `packages/core/test/sources/ytdlp.test.ts`

**Interfaces:**
- Produces: `parseJson3Cues(json: { events?: Json3Event[] }): RawCue[]`; exported `interface Json3Seg { utf8?: string }`, `interface Json3Event { tStartMs?: number; dDurationMs?: number; segs?: Json3Seg[] }`. `RawCue` is imported type-only from `./youtube` (`{ start: number; end: number; text: string; speaker?: string }`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from 'vitest';
import { parseJson3Cues } from '../../src/sources/ytdlp.js';

describe('parseJson3Cues', () => {
  test('joins multi-seg events; start/end in seconds', () => {
    const cues = parseJson3Cues({
      events: [
        { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'hello' }, { utf8: ' world' }] },
        { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: 'next' }] },
      ],
    });
    expect(cues).toEqual([
      { start: 0, end: 2, text: 'hello world' },
      { start: 2, end: 3.5, text: 'next' },
    ]);
  });

  test('drops empty / whitespace-only / seg-less events', () => {
    const cues = parseJson3Cues({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '   ' }] }, // whitespace
        { tStartMs: 1000, dDurationMs: 1000 },                       // no segs (window def)
        { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'keep' }] },
      ],
    });
    expect(cues).toEqual([{ start: 2, end: 3, text: 'keep' }]);
  });

  test('missing fields tolerated: no events, missing dDurationMs, missing utf8', () => {
    expect(parseJson3Cues({})).toEqual([]);
    expect(parseJson3Cues({ events: [{ tStartMs: 5000, segs: [{ utf8: 'x' }] }] }))
      .toEqual([{ start: 5, end: 5, text: 'x' }]); // dDurationMs missing → end === start
    expect(parseJson3Cues({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{}] }] }))
      .toEqual([]); // utf8 missing → empty → dropped
  });

  test('non-numeric tStartMs event is skipped', () => {
    expect(parseJson3Cues({ events: [{ dDurationMs: 1000, segs: [{ utf8: 'x' }] }] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: FAIL — cannot find module `../../src/sources/ytdlp.js` / `parseJson3Cues is not a function`.

- [ ] **Step 3: Create `ytdlp.ts` with the parser**

```typescript
import type { RawCue } from './youtube';

export interface Json3Seg {
  utf8?: string;
}
export interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Seg[];
}

// json3: events[].segs[].utf8 joined per event; start = tStartMs/1000,
// end = (tStartMs + dDurationMs)/1000; empty/whitespace cues dropped (spec §4.1).
export function parseJson3Cues(json: { events?: Json3Event[] }): RawCue[] {
  const out: RawCue[] = [];
  for (const ev of json.events ?? []) {
    if (typeof ev.tStartMs !== 'number') continue;
    const text = (ev.segs ?? []).map((s) => s.utf8 ?? '').join('');
    if (text.trim().length === 0) continue;
    const start = ev.tStartMs / 1000;
    const end = (ev.tStartMs + (ev.dDurationMs ?? 0)) / 1000;
    out.push({ start, end, text });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: PASS (parseJson3Cues block green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources/ytdlp.ts packages/core/test/sources/ytdlp.test.ts
git commit -m "feat(youtube): parseJson3Cues — json3 events → RawCue[]"
```

---

### Task 3: Pure classifier — `classifyYtdlpError`

**Files:**
- Modify: `packages/core/src/sources/ytdlp.ts`
- Test: `packages/core/test/sources/ytdlp.test.ts`

**Interfaces:**
- Produces: `classifyYtdlpError(exitCode: number, stderr: string): 'transient' | 'definitive'`.

- [ ] **Step 1: Write the failing test**

```typescript
import { classifyYtdlpError } from '../../src/sources/ytdlp.js';

describe('classifyYtdlpError', () => {
  test.each([
    ['ERROR: [youtube] Private video. Sign in if you've been granted access', 'definitive'],
    ['ERROR: Video unavailable', 'definitive'],
    ['ERROR: This video has been removed by the uploader', 'definitive'],
    ['ERROR: Join this channel to get access to members-only content', 'definitive'],
    ['ERROR: Sign in to confirm your age', 'definitive'],
    ['ERROR: The uploader has not made this video available in your country', 'definitive'],
    ['ERROR: HTTP Error 429: Too Many Requests', 'definitive'],
    ['ERROR: Unable to download API page: <urlopen error> automated queries', 'definitive'],
    ['ERROR: Sign in to confirm you're not a bot', 'definitive'],
  ])('anti-bot / content blocks are definitive: %s', (stderr, expected) => {
    expect(classifyYtdlpError(1, stderr)).toBe(expected);
  });

  test.each([
    ['ERROR: HTTP Error 503: Service Unavailable', 'transient'],
    ['ERROR: Unable to download webpage: The read operation timed out', 'transient'],
    ['ERROR: <urlopen error [Errno -3] Temporary failure in name resolution>', 'transient'],
    ['ERROR: Connection reset by peer', 'transient'],
  ])('genuine infrastructure is transient: %s', (stderr, expected) => {
    expect(classifyYtdlpError(1, stderr)).toBe(expected);
  });

  test('unknown nonzero exit defaults to definitive (safer on the caption path)', () => {
    expect(classifyYtdlpError(1, 'ERROR: something we have never seen')).toBe('definitive');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: FAIL — `classifyYtdlpError is not a function`.

- [ ] **Step 3: Implement the classifier in `ytdlp.ts`**

```typescript
// Anti-bot (429 / bot/attestation) and content-unavailability are DEFINITIVE at the
// caption layer: a same-IP retry can't clear them and extract's terminal is markFailed,
// so retrying only risks state='failed' (spec §7). Checked FIRST so a 429 that also
// emits "Unable to download webpage" lands definitive.
const DEFINITIVE_PATTERNS: RegExp[] = [
  /private video/i,
  /video unavailable/i,
  /has been removed|been terminated|account associated with this video has been/i,
  /members?-only|join this channel/i,
  /sign in to confirm your age|age-restricted/i,
  /not available in your country|blocked it in your country|geo/i,
  /HTTP Error 429|too many requests|automated queries/i,
  /confirm you'?re not a bot/i,
];

// Genuine infrastructure only (spec §7): DNS / reset / timeout / 5xx / network "Unable
// to download webpage". Throw → pg-boss retry → (still down at exhaustion → failed,
// the correct signal for a real outage).
const TRANSIENT_PATTERNS: RegExp[] = [
  /HTTP Error 5\d\d/i,
  /unable to download webpage/i,
  /timed out|timeout/i,
  /connection (reset|refused|aborted)/i,
  /temporary failure|getaddrinfo|EAI_AGAIN|ECONNRESET|ETIMEDOUT/i,
];

export function classifyYtdlpError(_exitCode: number, stderr: string): 'transient' | 'definitive' {
  if (DEFINITIVE_PATTERNS.some((r) => r.test(stderr))) return 'definitive';
  if (TRANSIENT_PATTERNS.some((r) => r.test(stderr))) return 'transient';
  return 'definitive'; // unknown nonzero → degrade-and-continue, never risk failed (spec §7)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources/ytdlp.ts packages/core/test/sources/ytdlp.test.ts
git commit -m "feat(youtube): classifyYtdlpError — 429/bot definitive, network transient"
```

---

### Task 4: Pure selector — `selectCaptionTrack`

**Files:**
- Modify: `packages/core/src/sources/ytdlp.ts`
- Test: `packages/core/test/sources/ytdlp.test.ts`

**Interfaces:**
- Produces: exported `interface YtdlpInfo { title?: string | null; duration?: number | null; subtitles?: Record<string, unknown[]>; automatic_captions?: Record<string, unknown[]> }`; `type CaptionSelection = { lang: string; kind: 'manual' | 'auto' } | null`; `const CAPTION_LANG_PREFS: string[]`; `selectCaptionTrack(info: YtdlpInfo, prefs?: string[]): CaptionSelection`.

- [ ] **Step 1: Write the failing test**

```typescript
import { selectCaptionTrack } from '../../src/sources/ytdlp.js';

describe('selectCaptionTrack', () => {
  const track = [{ ext: 'json3', url: 'https://x' }];

  test('manual subs preferred over auto', () => {
    expect(selectCaptionTrack({ subtitles: { en: track }, automatic_captions: { en: track } }))
      .toEqual({ lang: 'en', kind: 'manual' });
  });

  test('falls back to auto when no manual subs', () => {
    expect(selectCaptionTrack({ subtitles: {}, automatic_captions: { en: track } }))
      .toEqual({ lang: 'en', kind: 'auto' });
  });

  test('honours preference order within a map', () => {
    expect(selectCaptionTrack({ subtitles: { en: track, 'zh-Hans': track } }, ['zh-Hans', 'en']))
      .toEqual({ lang: 'zh-Hans', kind: 'manual' });
  });

  test('no preference match → first available language', () => {
    expect(selectCaptionTrack({ subtitles: { de: track } }, ['en']))
      .toEqual({ lang: 'de', kind: 'manual' });
  });

  test('empty track lists are ignored', () => {
    expect(selectCaptionTrack({ subtitles: { en: [] }, automatic_captions: { fr: track } }))
      .toEqual({ lang: 'fr', kind: 'auto' });
  });

  test('no captions anywhere → null', () => {
    expect(selectCaptionTrack({ subtitles: {}, automatic_captions: {} })).toBeNull();
    expect(selectCaptionTrack({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: FAIL — `selectCaptionTrack is not a function`.

- [ ] **Step 3: Implement the selector in `ytdlp.ts`**

```typescript
export interface YtdlpInfo {
  title?: string | null;
  duration?: number | null;
  subtitles?: Record<string, unknown[]>;
  automatic_captions?: Record<string, unknown[]>;
}

export type CaptionSelection = { lang: string; kind: 'manual' | 'auto' } | null;

// Bilingual user (zh/en); fall back to whatever the video offers. Translated-caption
// filtering is out of scope — downstream embed/score is language-agnostic (spec §4.1).
export const CAPTION_LANG_PREFS = ['zh-Hans', 'zh-Hant', 'zh', 'en'];

function pickLang(map: Record<string, unknown[]> | undefined, prefs: string[]): string | null {
  const langs = Object.keys(map ?? {}).filter((l) => (map![l]?.length ?? 0) > 0);
  if (langs.length === 0) return null;
  for (const p of prefs) if (langs.includes(p)) return p;
  return langs[0]!;
}

// Preference: manual → auto → none (spec §4.1; auto-generated ASR captions accepted).
export function selectCaptionTrack(info: YtdlpInfo, prefs: string[] = CAPTION_LANG_PREFS): CaptionSelection {
  const manual = pickLang(info.subtitles, prefs);
  if (manual) return { lang: manual, kind: 'manual' };
  const auto = pickLang(info.automatic_captions, prefs);
  if (auto) return { lang: auto, kind: 'auto' };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources/ytdlp.ts packages/core/test/sources/ytdlp.test.ts
git commit -m "feat(youtube): selectCaptionTrack — manual → auto → none"
```

---

### Task 5: Pure arg builder — `buildYtdlpArgs`

**Files:**
- Modify: `packages/core/src/sources/ytdlp.ts`
- Test: `packages/core/test/sources/ytdlp.test.ts`

**Interfaces:**
- Produces: exported `type YtdlpMode = { kind: 'info' } | { kind: 'subs'; lang: string; outTemplate: string } | { kind: 'audio'; outTemplate: string }`; `interface YtdlpArgsOpts { mode: YtdlpMode; potProviderBaseUrl?: string | null }`; `buildYtdlpArgs(videoId: string, opts: YtdlpArgsOpts): string[]`.

- [ ] **Step 1: Write the failing test**

```typescript
import { buildYtdlpArgs } from '../../src/sources/ytdlp.js';

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

describe('buildYtdlpArgs', () => {
  test('info mode → -J --skip-download against the canonical URL (URL last)', () => {
    const args = buildYtdlpArgs('dQw4w9WgXcQ', { mode: { kind: 'info' } });
    expect(args).toContain('-J');
    expect(args).toContain('--skip-download');
    expect(args).toContain('--no-playlist');
    expect(args[args.length - 1]).toBe(URL);
  });

  test('subs mode → write-subs + write-auto-subs + json3 + lang + output template', () => {
    const args = buildYtdlpArgs('dQw4w9WgXcQ', { mode: { kind: 'subs', lang: 'en', outTemplate: '/tmp/d/sub.%(ext)s' } });
    expect(args).toEqual(expect.arrayContaining([
      '--write-subs', '--write-auto-subs', '--sub-langs', 'en', '--sub-format', 'json3', '-o', '/tmp/d/sub.%(ext)s',
    ]));
    expect(args[args.length - 1]).toBe(URL);
  });

  test('audio mode → -f bestaudio + output template', () => {
    const args = buildYtdlpArgs('dQw4w9WgXcQ', { mode: { kind: 'audio', outTemplate: '/tmp/d/audio.%(ext)s' } });
    expect(args).toEqual(expect.arrayContaining(['-f', 'bestaudio', '-o', '/tmp/d/audio.%(ext)s']));
    expect(args[args.length - 1]).toBe(URL);
  });

  test('pot provider set → adds --extractor-args (only when configured)', () => {
    const off = buildYtdlpArgs('dQw4w9WgXcQ', { mode: { kind: 'info' } });
    expect(off).not.toContain('--extractor-args');
    const on = buildYtdlpArgs('dQw4w9WgXcQ', { mode: { kind: 'info' }, potProviderBaseUrl: 'http://sidecar:4416' });
    const i = on.indexOf('--extractor-args');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(on[i + 1]).toContain('http://sidecar:4416');
  });

  test('rejects a non-canonical videoId (no shell injection via the URL)', () => {
    expect(() => buildYtdlpArgs('; rm -rf /', { mode: { kind: 'info' } })).toThrow(/non-canonical/);
    expect(() => buildYtdlpArgs('dQw4w9WgXcQ&malicious', { mode: { kind: 'info' } })).toThrow(/non-canonical/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: FAIL — `buildYtdlpArgs is not a function`.

- [ ] **Step 3: Implement the builder in `ytdlp.ts`**

```typescript
export type YtdlpMode =
  | { kind: 'info' }
  | { kind: 'subs'; lang: string; outTemplate: string }
  | { kind: 'audio'; outTemplate: string };

export interface YtdlpArgsOpts {
  mode: YtdlpMode;
  potProviderBaseUrl?: string | null;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

// [SPIKE-SELECTED] The pot plugin's extractor-arg key. Default is the bgutil HTTP
// provider form; Task 1 confirms the literal that reaches the sidecar (POT_EXTRACTOR_ARG).
const POT_EXTRACTOR_ARG_KEY = 'youtubepot-bgutilhttp:base_url';

// Reconstruct the canonical watch URL from the PARSED, VALIDATED videoId — never the
// raw pasted string (spec §2). videoId is validated here as defence-in-depth even though
// callers pass parseYoutubeVideoId() output. All args are passed as an array to spawn
// (no shell), so even a hostile id cannot inject — but we refuse it anyway.
export function buildYtdlpArgs(videoId: string, opts: YtdlpArgsOpts): string[] {
  if (!YT_ID.test(videoId)) {
    throw new Error(`Refusing to build yt-dlp args for non-canonical videoId: ${videoId}`);
  }
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const args = ['--no-playlist', '--no-warnings'];
  if (opts.potProviderBaseUrl) {
    args.push('--extractor-args', `${POT_EXTRACTOR_ARG_KEY}=${opts.potProviderBaseUrl}`);
  }
  switch (opts.mode.kind) {
    case 'info':
      args.push('-J', '--skip-download');
      break;
    case 'subs':
      args.push(
        '--skip-download', '--write-subs', '--write-auto-subs',
        '--sub-langs', opts.mode.lang, '--sub-format', 'json3', '-o', opts.mode.outTemplate,
      );
      break;
    case 'audio':
      args.push('-f', 'bestaudio', '-o', opts.mode.outTemplate);
      break;
  }
  args.push(url);
  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources/ytdlp.ts packages/core/test/sources/ytdlp.test.ts
git commit -m "feat(youtube): buildYtdlpArgs — canonical URL, no-shell, pot args"
```

---

### Task 6: Subprocess scaffolding — `runYtdlp`, the capability gate, and degraded constant

**Files:**
- Modify: `packages/core/src/sources/ytdlp.ts`
- Test: `packages/core/test/sources/ytdlp.test.ts`

**Interfaces:**
- Produces: `interface YtdlpResult { code: number; stdout: string; stderr: string }`; `type YtdlpRun = (args: string[]) => Promise<YtdlpResult>`; default `runYtdlp: YtdlpRun`; `isYoutubeBackendEnabled(): boolean`; `isYoutubeAudioEnabled(): boolean`. Imports `env` from `../config/env`.

- [ ] **Step 1: Write the failing test**

```typescript
import { afterEach } from 'vitest';

afterEach(() => { vi.unstubAllEnvs?.(); vi.resetModules?.(); });

describe('isYoutubeBackendEnabled (gate; [SPIKE-SELECTED] keep-sidecar form)', () => {
  test('docker mode + POTOKEN set → enabled', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker');
    vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://sidecar:4416');
    const { isYoutubeBackendEnabled } = await import('../../src/sources/ytdlp.js');
    expect(isYoutubeBackendEnabled()).toBe(true);
  });

  test('serverless → disabled (no subprocess available)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'serverless');
    vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://sidecar:4416');
    const { isYoutubeBackendEnabled } = await import('../../src/sources/ytdlp.js');
    expect(isYoutubeBackendEnabled()).toBe(false);
  });

  test('docker mode but POTOKEN unset → disabled (keep-sidecar form)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker');
    vi.stubEnv('POTOKEN_PROVIDER_URL', '');
    const { isYoutubeBackendEnabled } = await import('../../src/sources/ytdlp.js');
    expect(isYoutubeBackendEnabled()).toBe(false);
  });
});
```

> Add `import { vi } from 'vitest'` to the test file's imports if not already present, and ensure `describe/expect/test` are imported. (Top-of-file imports are shared across the Task 2–7 blocks in this one file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: FAIL — `isYoutubeBackendEnabled is not a function`.

- [ ] **Step 3: Implement scaffolding in `ytdlp.ts`**

Add the import at the top of the file and the implementations:

```typescript
import { spawn } from 'node:child_process';
import { env } from '../config/env';
```

```typescript
export interface YtdlpResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type YtdlpRun = (args: string[]) => Promise<YtdlpResult>;

// Production runner: spawn with an arg ARRAY (no shell, spec §2). Resolves with the
// exit code + captured streams (never rejects on nonzero — callers classify the code);
// rejects only when the binary itself can't start (ENOENT).
const runYtdlp: YtdlpRun = (args) =>
  new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let stdout = ''; let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

// Single capability chokepoint (spec §5/§10). The gate guards BOTH the caption path
// (fetchYoutubeTrack) and — via the Layer-2 handoff — the audio path. Serverless has no
// subprocess, so it is always off.
// [SPIKE-SELECTED] keep-sidecar form. If Task 1 set SIDECAR=drop, replace the body with:
//   return env.DEPLOY_MODE !== 'serverless';
export function isYoutubeBackendEnabled(): boolean {
  return env.DEPLOY_MODE !== 'serverless' && Boolean(env.POTOKEN_PROVIDER_URL);
}

// [SPIKE-SELECTED] Probe 3 passed → true. If Task 1 set AUDIO=descoped, return false:
// the no-caption → Whisper path is dropped, caption-less YouTube degrades to
// 'unavailable' + continue (spec §6). Consumed by the Layer-2 handoff gate.
export function isYoutubeAudioEnabled(): boolean {
  return true;
}

export { runYtdlp };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources/ytdlp.ts packages/core/test/sources/ytdlp.test.ts
git commit -m "feat(youtube): runYtdlp + isYoutubeBackendEnabled/isYoutubeAudioEnabled gate"
```

---

### Task 7: Caption wrapper — `fetchYoutubeTrack` (gate + per-stage terminal mapping)

**Files:**
- Modify: `packages/core/src/sources/ytdlp.ts`
- Test: `packages/core/test/sources/ytdlp.test.ts`

**Interfaces:**
- Consumes: `buildYtdlpArgs`, `classifyYtdlpError`, `selectCaptionTrack`, `parseJson3Cues`, `isYoutubeBackendEnabled`, `runYtdlp` (Tasks 2–6); `TransientFetchError` from `./types`; type `RawSubtitleTrack` from `./youtube`.
- Produces: `fetchYoutubeTrack(videoId: string, run?: YtdlpRun): Promise<RawSubtitleTrack>`.

**Note on the gate test (binding, spec §5):** with the backend disabled, `fetchYoutubeTrack` must return a degraded track **without calling the injected `run`**. The test asserts the runner is never invoked.

- [ ] **Step 1: Write the failing test**

```typescript
import { TransientFetchError } from '../../src/sources/types.js';

const SUBS_OK = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'hi' }] }] });
function infoJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ title: 'T', duration: 120, subtitles: { en: [{ ext: 'json3' }] }, ...over });
}

describe('fetchYoutubeTrack', () => {
  // The backend-off gate writes a json3 file the wrapper reads; we fake `run` to create it.
  test('backend OFF → degraded track WITHOUT invoking run (the §5 hard gate)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'serverless'); // off
    const run = vi.fn();
    const { fetchYoutubeTrack } = await import('../../src/sources/ytdlp.js');
    const track = await fetchYoutubeTrack('dQw4w9WgXcQ', run as never);
    expect(run).not.toHaveBeenCalled();
    expect(track).toEqual({ durationSeconds: null, title: null, cues: [] });
  });

  test('transient -J failure → throws TransientFetchError (caption path retries)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker'); vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://s:4416');
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'ERROR: HTTP Error 503' }));
    const { fetchYoutubeTrack } = await import('../../src/sources/ytdlp.js');
    await expect(fetchYoutubeTrack('dQw4w9WgXcQ', run)).rejects.toBeInstanceOf(TransientFetchError);
  });

  test('definitive -J failure (429/bot) → degrades, never throws (the §7 crux)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker'); vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://s:4416');
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'ERROR: HTTP Error 429 automated queries' }));
    const { fetchYoutubeTrack } = await import('../../src/sources/ytdlp.js');
    const track = await fetchYoutubeTrack('dQw4w9WgXcQ', run);
    expect(track).toEqual({ durationSeconds: null, title: null, cues: [] });
  });

  test('no captions → degraded WITH duration/title (Layer-2 can fire on known duration)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker'); vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://s:4416');
    const run = vi.fn(async () => ({ code: 0, stdout: infoJson({ subtitles: {}, automatic_captions: {} }), stderr: '' }));
    const { fetchYoutubeTrack } = await import('../../src/sources/ytdlp.js');
    const track = await fetchYoutubeTrack('dQw4w9WgXcQ', run);
    expect(track).toEqual({ durationSeconds: 120, title: 'T', cues: [] });
    expect(run).toHaveBeenCalledTimes(1); // info only; no subs download
  });

  test('captions present → info + subs download → parsed cues', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker'); vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://s:4416');
    let call = 0;
    const run = vi.fn(async (args: string[]) => {
      call += 1;
      if (call === 1) return { code: 0, stdout: infoJson(), stderr: '' };
      // subs call: write a json3 file into the -o directory so the wrapper can read it.
      const i = args.indexOf('-o');
      const tmpl = args[i + 1]!; // .../sub.%(ext)s
      const { writeFile } = await import('node:fs/promises');
      await writeFile(tmpl.replace('%(ext)s', 'en.json3'), SUBS_OK, 'utf8');
      return { code: 0, stdout: '', stderr: '' };
    });
    const { fetchYoutubeTrack } = await import('../../src/sources/ytdlp.js');
    const track = await fetchYoutubeTrack('dQw4w9WgXcQ', run);
    expect(track.durationSeconds).toBe(120);
    expect(track.title).toBe('T');
    expect(track.cues).toEqual([{ start: 0, end: 1, text: 'hi' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: FAIL — `fetchYoutubeTrack is not a function`.

- [ ] **Step 3: Implement `fetchYoutubeTrack` in `ytdlp.ts`**

Add fs/path/os imports at the top:

```typescript
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TransientFetchError } from './types';
import type { RawCue, RawSubtitleTrack } from './youtube';
```

> The Task 2 `import type { RawCue }` line is now subsumed by this combined import — keep a single `import type { RawCue, RawSubtitleTrack } from './youtube';`.

```typescript
const DEGRADED: RawSubtitleTrack = { durationSeconds: null, title: null, cues: [] };

// Caption path (spec §4.1/§7). GATE FIRST: when the backend is off, degrade WITHOUT
// spawning (the §5 hard gate — serverless extract must never attempt a subprocess).
// transient → throw (pg-boss retries); definitive (incl. 429/bot) → degrade, NEVER throw.
export async function fetchYoutubeTrack(videoId: string, run: YtdlpRun = runYtdlp): Promise<RawSubtitleTrack> {
  if (!isYoutubeBackendEnabled()) return { ...DEGRADED };
  const pot = env.POTOKEN_PROVIDER_URL ?? null;

  const info = await run(buildYtdlpArgs(videoId, { mode: { kind: 'info' }, potProviderBaseUrl: pot }));
  if (info.code !== 0) {
    if (classifyYtdlpError(info.code, info.stderr) === 'transient') {
      throw new TransientFetchError(`yt-dlp -J failed (${info.code}): ${info.stderr.slice(0, 300)}`);
    }
    console.warn(`[youtube] ${videoId} degraded: yt-dlp -J ${info.stderr.slice(0, 200)}`);
    return { ...DEGRADED };
  }

  let meta: YtdlpInfo;
  try {
    meta = JSON.parse(info.stdout) as YtdlpInfo;
  } catch {
    console.warn(`[youtube] ${videoId} degraded: unparseable -J output`);
    return { ...DEGRADED };
  }

  const durationSeconds = typeof meta.duration === 'number' ? meta.duration : null;
  const title = meta.title ?? null;
  const sel = selectCaptionTrack(meta);
  if (!sel) return { durationSeconds, title, cues: [] }; // no captions → Layer 2 (§4.2)

  const dir = await mkdtemp(join(tmpdir(), 'benkyou-ytsub-'));
  try {
    const subs = await run(
      buildYtdlpArgs(videoId, {
        mode: { kind: 'subs', lang: sel.lang, outTemplate: join(dir, 'sub.%(ext)s') },
        potProviderBaseUrl: pot,
      }),
    );
    if (subs.code !== 0) {
      if (classifyYtdlpError(subs.code, subs.stderr) === 'transient') {
        throw new TransientFetchError(`yt-dlp subs failed (${subs.code}): ${subs.stderr.slice(0, 300)}`);
      }
      console.warn(`[youtube] ${videoId} degraded: yt-dlp subs ${subs.stderr.slice(0, 200)}`);
      return { durationSeconds, title, cues: [] };
    }
    const files = await readdir(dir);
    const json3 = files.find((f) => f.endsWith('.json3'));
    if (!json3) {
      console.warn(`[youtube] ${videoId} degraded: no json3 written`);
      return { durationSeconds, title, cues: [] };
    }
    const cues = parseJson3Cues(JSON.parse(await readFile(join(dir, json3), 'utf8')) as { events?: Json3Event[] });
    return { durationSeconds, title, cues };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: PASS (all `fetchYoutubeTrack` cases green; runner never called when off).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources/ytdlp.ts packages/core/test/sources/ytdlp.test.ts
git commit -m "feat(youtube): fetchYoutubeTrack — gated caption path + per-stage terminal mapping"
```

---

### Task 8: Audio wrapper — `downloadYoutubeAudio` (the SABR byte path)

> **AUDIO=descoped variant:** if Task 1 set `AUDIO=descoped`, **skip this task entirely.** `downloadYoutubeAudio` is never called (Tasks 11/10 gate it off via `isYoutubeAudioEnabled()`), and caption-less YouTube videos degrade to `unavailable` + continue.

**Files:**
- Modify: `packages/core/src/sources/ytdlp.ts`
- Test: `packages/core/test/sources/ytdlp.test.ts`

**Interfaces:**
- Produces: `downloadYoutubeAudio(videoId: string, run?: YtdlpRun): Promise<{ path: string; cleanup: () => Promise<void> }>`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('downloadYoutubeAudio', () => {
  test('writes bestaudio to a tmp dir; returns its path; cleanup removes the dir', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker'); vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://s:4416');
    const run = vi.fn(async (args: string[]) => {
      const i = args.indexOf('-o');
      const tmpl = args[i + 1]!; // .../audio.%(ext)s
      const { writeFile } = await import('node:fs/promises');
      await writeFile(tmpl.replace('%(ext)s', 'webm'), 'AUDIOBYTES', 'utf8');
      return { code: 0, stdout: '', stderr: '' };
    });
    const { downloadYoutubeAudio } = await import('../../src/sources/ytdlp.js');
    const { path, cleanup } = await downloadYoutubeAudio('dQw4w9WgXcQ', run);
    const { readFile, access } = await import('node:fs/promises');
    expect(await readFile(path, 'utf8')).toBe('AUDIOBYTES');
    await cleanup();
    await expect(access(path)).rejects.toBeTruthy(); // dir gone
  });

  test('nonzero exit → throws and cleans up (transcribe degrades)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'docker'); vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://s:4416');
    const run = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'ERROR: boom' }));
    const { downloadYoutubeAudio } = await import('../../src/sources/ytdlp.js');
    await expect(downloadYoutubeAudio('dQw4w9WgXcQ', run)).rejects.toThrow(/audio download failed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: FAIL — `downloadYoutubeAudio is not a function`.

- [ ] **Step 3: Implement `downloadYoutubeAudio` in `ytdlp.ts`**

```typescript
// Audio path (spec §4.2). Under SABR there is NO audio URL — yt-dlp fetches bestaudio
// bytes to worker tmp. Any failure throws; transcribe's onFail degrades to 'unavailable'
// regardless (M2b), so no definitive/transient split here (spec §7).
export async function downloadYoutubeAudio(
  videoId: string,
  run: YtdlpRun = runYtdlp,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const pot = env.POTOKEN_PROVIDER_URL ?? null;
  const dir = await mkdtemp(join(tmpdir(), 'benkyou-ytaudio-'));
  const cleanup = async (): Promise<void> => { await rm(dir, { recursive: true, force: true }); };
  try {
    const res = await run(
      buildYtdlpArgs(videoId, { mode: { kind: 'audio', outTemplate: join(dir, 'audio.%(ext)s') }, potProviderBaseUrl: pot }),
    );
    if (res.code !== 0) throw new Error(`yt-dlp audio download failed (${res.code}): ${res.stderr.slice(0, 500)}`);
    const files = await readdir(dir);
    const audio = files.find((f) => f.startsWith('audio.'));
    if (!audio) throw new Error('yt-dlp produced no audio file');
    return { path: join(dir, audio), cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core test ytdlp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources/ytdlp.ts packages/core/test/sources/ytdlp.test.ts
git commit -m "feat(youtube): downloadYoutubeAudio — bestaudio bytes to worker tmp"
```

---

### Task 9: Relocate `pingPotokenSidecar`; delete the PoToken client

**Files:**
- Create: `packages/core/src/sources/potoken-health.ts`
- Create: `packages/core/test/sources/potoken-health.test.ts`
- Modify: `packages/core/src/pipeline/status.ts:4`
- Delete: `packages/core/src/sources/potoken-client.ts`
- Delete: `packages/core/test/sources/potoken-client.test.ts`
- Delete: `packages/core/test/sources/youtube-potoken-spike.int.test.ts`

**Interfaces:**
- Produces: `pingPotokenSidecar(providerUrl: string): Promise<boolean>` (moved verbatim; consumed by `pipeline/status.ts:getPotokenHealth`).

- [ ] **Step 1: Create `potoken-health.ts` with the moved function**

```typescript
// Generic sidecar health check (spec §8). Survives the youtubei.js retirement because
// /admin/jobs still surfaces clustered YouTube degradation (the extract-cloudflare trap).
// yt-dlp's pot plugin owns token FETCH now; this is health-only.
export async function pingPotokenSidecar(providerUrl: string): Promise<boolean> {
  const base = providerUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/ping`);
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Create the moved test**

```typescript
import { afterEach, describe, expect, test, vi } from 'vitest';
import { pingPotokenSidecar } from '../../src/sources/potoken-health.js';

afterEach(() => vi.restoreAllMocks());

describe('pingPotokenSidecar', () => {
  test('true on 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await pingPotokenSidecar('http://sidecar:4416')).toBe(true);
  });
  test('false on error / non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await pingPotokenSidecar('http://sidecar:4416')).toBe(false);
  });
});
```

- [ ] **Step 3: Repoint `status.ts` import**

In `packages/core/src/pipeline/status.ts:4`, change:

```typescript
import { pingPotokenSidecar } from '../sources/potoken-client';
```
to:
```typescript
import { pingPotokenSidecar } from '../sources/potoken-health';
```

- [ ] **Step 4: Delete the retired client + its tests**

```bash
git rm packages/core/src/sources/potoken-client.ts \
       packages/core/test/sources/potoken-client.test.ts \
       packages/core/test/sources/youtube-potoken-spike.int.test.ts
```

- [ ] **Step 5: Run the affected suites**

Run: `pnpm --filter @benkyou/core test potoken-health status`
Expected: PASS — `pingPotokenSidecar` and `getPotokenHealth` green; no import of `potoken-client` remains.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sources/potoken-health.ts packages/core/test/sources/potoken-health.test.ts packages/core/src/pipeline/status.ts
git commit -m "refactor(youtube): relocate pingPotokenSidecar to potoken-health; drop PoToken client"
```

---

### Task 10: Rewire `extract.ts` — `isYoutubeBackendEnabled` gates the Layer-2 handoff

**Files:**
- Modify: `packages/core/src/pipeline/extract.ts:13` (import) and `:73-82,:164` (handoff gate + arg)
- Modify: `packages/core/test/pipeline/extract-youtube-handoff.int.test.ts` (drop the youtube-session mock)

**Interfaces:**
- Consumes: `isYoutubeBackendEnabled`, `isYoutubeAudioEnabled` from `../sources/ytdlp` (Task 6).

- [ ] **Step 1: Update the import in `extract.ts`**

Replace line 13:
```typescript
import { isPotokenEnabled } from '../sources/youtube-session';
```
with:
```typescript
import { isYoutubeBackendEnabled, isYoutubeAudioEnabled } from '../sources/ytdlp';
```

- [ ] **Step 2: Update the handoff predicate's parameter name and call site**

In `isYoutubeWhisperHandoff` (lines 73–82), rename the second parameter from `potokenEnabled` to `audioHandoffEnabled` (semantics unchanged — a single boolean), so the doc reads true:

```typescript
export function isYoutubeWhisperHandoff(
  item: { contentType: string; transcriptStatus: string; url: string; videoDuration: number | null },
  audioHandoffEnabled: boolean,
): boolean {
  return item.contentType === 'video'
    && item.transcriptStatus === 'unavailable'
    && audioHandoffEnabled
    && item.videoDuration != null
    && parseYoutubeVideoId(item.url) != null;
}
```

At the call site (line 164), replace `isPotokenEnabled(),` with the combined capability — backend on **and** audio in scope (so `AUDIO=descoped` cleanly disables the Whisper handoff per spec §6):

```typescript
    isYoutubeBackendEnabled() && isYoutubeAudioEnabled(),
```

- [ ] **Step 3: Fix the int test — drop the deleted-module mock**

In `packages/core/test/pipeline/extract-youtube-handoff.int.test.ts`, **remove** the `vi.mock('../../src/sources/youtube-session.js', ...)` block (lines ~8–12). The env stub `vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://sidecar:4416')` **stays** (with the docker default `DEPLOY_MODE`, `isYoutubeBackendEnabled()` is true). The test already stubs `adapter.extract` directly, so no subprocess runs.

```typescript
// PoToken capability ON for these tests (docker default + provider URL → backend enabled).
vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://sidecar:4416');

// (the youtube-session vi.mock block is deleted — that module no longer exists)
```

- [ ] **Step 4: Run the affected suites**

Run: `pnpm --filter @benkyou/core test youtube-whisper-handoff extract-youtube-handoff`
Expected: PASS — handoff unit cases unchanged; int test still parks `pending` + enqueues transcribe for the known-duration case and degrades for null-duration.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/extract.ts packages/core/test/pipeline/extract-youtube-handoff.int.test.ts
git commit -m "refactor(youtube): gate Layer-2 handoff on isYoutubeBackendEnabled && isYoutubeAudioEnabled"
```

---

### Task 11: Rewire `transcribe.ts` — download YouTube audio bytes via yt-dlp

> **AUDIO=descoped variant:** if Task 1 set `AUDIO=descoped`, **skip the `downloadYoutubeAudio` branch** — but still **delete** `resolveDownloadSource` + `resolveYoutubeAudioUrl` usage (that module is removed in Task 12). In the descoped world a YouTube item never reaches transcribe (the Layer-2 handoff is gated off in Task 10), so `transcribeItem` only needs the non-YouTube `downloadToTmp` path. Implement Steps 1–3 below but replace the YouTube branch body with `throw new Error('YouTube audio transcription is descoped this round')` (defensive — it is unreachable). Keep the `isYoutubeTranscribeSource` helper + its test.

**Files:**
- Modify: `packages/core/src/pipeline/transcribe.ts` (imports, replace `resolveDownloadSource`, rewire `transcribeItem`)
- Delete: `packages/core/test/pipeline/transcribe-youtube-resolve.test.ts`
- Test: add `isYoutubeTranscribeSource` cases to a new `packages/core/test/pipeline/transcribe-source.test.ts`

**Interfaces:**
- Consumes: `downloadYoutubeAudio` from `../sources/ytdlp` (Task 8); `parseYoutubeVideoId` from `../sources/youtube`.
- Produces: `isYoutubeTranscribeSource(item: { mediaUrl: string | null; url: string }): string | null` (returns the videoId when the item should be fetched via yt-dlp, else null).

- [ ] **Step 1: Write the failing test for the new pure seam**

Create `packages/core/test/pipeline/transcribe-source.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { isYoutubeTranscribeSource } from '../../src/pipeline/transcribe.js';

describe('isYoutubeTranscribeSource', () => {
  test('YouTube watch URL, no mediaUrl → returns the videoId (yt-dlp byte path)', () => {
    expect(isYoutubeTranscribeSource({ mediaUrl: null, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }))
      .toBe('dQw4w9WgXcQ');
  });
  test('mediaUrl present (podcast/direct) → null (use downloadToTmp verbatim)', () => {
    expect(isYoutubeTranscribeSource({ mediaUrl: 'https://cdn/a.mp3', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }))
      .toBeNull();
  });
  test('non-YouTube URL, no mediaUrl → null', () => {
    expect(isYoutubeTranscribeSource({ mediaUrl: null, url: 'https://example.com/a.mp3' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core test transcribe-source`
Expected: FAIL — `isYoutubeTranscribeSource is not a function`.

- [ ] **Step 3: Rewire `transcribe.ts`**

Replace the imports (lines 5–9) — drop `resolveYoutubeAudioUrl`, add `downloadYoutubeAudio`:

```typescript
import { downloadToTmp } from './media-probe';
import { probeRemoteDurationSec } from './media-probe';
import { transcribeRecorded } from '../ai/whisper';
import { buildWhisperConfig, getUserSettings } from '../settings';
import { parseYoutubeVideoId } from '../sources/youtube';
import { downloadYoutubeAudio } from '../sources/ytdlp';
```

> Keep the existing `downloadToTmp, probeRemoteDurationSec` import from `./media-probe` (consolidate to one line as the surrounding style prefers).

Delete `resolveDownloadSource` (lines 73–83) and replace it + `transcribeItem` with:

```typescript
// Returns the videoId when this item must be fetched via yt-dlp (SABR — no URL to hand
// to Whisper, spec §4.2): a YouTube watch URL with no direct mediaUrl. Otherwise null
// (podcasts / direct pastes carry a usable mediaUrl → downloadToTmp).
export function isYoutubeTranscribeSource(item: { mediaUrl: string | null; url: string }): string | null {
  if (item.mediaUrl) return null;
  return parseYoutubeVideoId(item.url);
}

export async function transcribeItem(
  item: TranscribeView,
): Promise<{ segments: TranscriptSegment[]; flatText: string; durationSec: number }> {
  const settings = await getUserSettings();
  if (!settings) throw new Error('user_settings not initialized');
  const cfg = buildWhisperConfig(settings);

  const videoId = isYoutubeTranscribeSource(item);
  let path: string;
  let cleanup: () => Promise<void>;
  let durationSec: number;

  if (videoId) {
    // YouTube: yt-dlp fetches bestaudio bytes to tmp. Duration is already known from
    // extract (yt-dlp -J populated video_duration; the Layer-2 gate requires it != null),
    // so no remote probe — that path would ffprobe the watch page (the §4.2 footgun).
    durationSec = item.durationSec ?? 0;
    if (durationSec <= 0) throw new Error('Could not resolve audio duration for transcription');
    ({ path, cleanup } = await downloadYoutubeAudio(videoId));
  } else {
    const source = item.mediaUrl ?? item.url;
    durationSec = item.durationSec ?? (await probeRemoteDurationSec(source)) ?? 0;
    if (durationSec <= 0) throw new Error('Could not resolve audio duration for transcription');
    ({ path, cleanup } = await downloadToTmp(source));
  }

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

- [ ] **Step 4: Delete the obsolete `resolveDownloadSource` test**

```bash
git rm packages/core/test/pipeline/transcribe-youtube-resolve.test.ts
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @benkyou/core test transcribe-source transcribe-merge`
Expected: PASS — new seam green; merge/chunk tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline/transcribe.ts packages/core/test/pipeline/transcribe-source.test.ts
git commit -m "refactor(youtube): transcribe YouTube via downloadYoutubeAudio byte path"
```

---

### Task 12: Rewire `youtube.ts`; delete `youtube-session.ts`

This is the task that **removes youtubei.js from the source tree.** After Tasks 10 and 11, `youtube-session.ts` has no remaining importers except `youtube.ts`, so it can be deleted here.

**Files:**
- Modify: `packages/core/src/sources/youtube.ts` (delegate to `fetchYoutubeTrack`; drop youtubei.js + youtube-session imports; remove `fetchOnce`, `INNERTUBE_OPTIONS`, `isDefinitiveYoutubeError`)
- Modify: `packages/core/test/sources/youtube.test.ts` (drop the youtubei.js / `INNERTUBE_OPTIONS` / `isDefinitiveYoutubeError` blocks)
- Delete: `packages/core/src/sources/youtube-session.ts`
- Delete: `packages/core/test/sources/youtube-session.test.ts`

**Interfaces:**
- Consumes: `fetchYoutubeTrack` from `./ytdlp` (Task 7).
- Produces (unchanged contracts kept): `parseYoutubeVideoId`, `createYoutubeAdapter`, `RawCue`, `RawSubtitleTrack`, `FetchYoutubeSubtitle`, `youtubeAdapter`.

- [ ] **Step 1: Rewrite `youtube.ts`**

Replace the whole file with the delegating version (keeps the adapter shell, `parseYoutubeVideoId`, `cuesToSegments`, `unavailable`; drops everything youtubei.js):

```typescript
import type { ExtractInput, ExtractResult, SourceAdapter, TranscriptSegment } from './types';
import { TransientFetchError } from './types';
import { fetchYoutubeTrack } from './ytdlp';

// Internal contract between the fragile subprocess edge and the pure transform.
// null  = definitive miss (no captions / video unavailable) → degrade to 'unavailable'.
// throw TransientFetchError = genuine transient (network/5xx) → dispatcher rethrows.
export interface RawCue {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}
export interface RawSubtitleTrack {
  durationSeconds: number | null;
  title?: string | null; // video title from yt-dlp -J; refines a URL-placeholder item title
  cues: RawCue[];
}
export type FetchYoutubeSubtitle = (videoId: string) => Promise<RawSubtitleTrack | null>;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYoutubeVideoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0] ?? '';
    return YT_ID.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const v = u.searchParams.get('v');
    if (v && YT_ID.test(v)) return v;
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] ?? '';
    return YT_ID.test(last) ? last : null;
  }
  return null;
}

function cuesToSegments(cues: RawCue[]): TranscriptSegment[] {
  return cues.map((c) => ({
    start: c.start,
    end: c.end,
    text: c.text,
    ...(c.speaker ? { speaker: c.speaker } : {}),
  }));
}

function unavailable(durationSeconds: number | null, title?: string | null): ExtractResult {
  return {
    rawContent: null,
    ...(title ? { title } : {}),
    contentType: 'video',
    transcriptStatus: 'unavailable',
    transcriptSegments: null,
    videoDuration: durationSeconds,
  };
}

export function createYoutubeAdapter(fetchSubtitle: FetchYoutubeSubtitle): SourceAdapter {
  return {
    type: 'youtube',
    async fetchItems() {
      throw new Error('youtube adapter is adhoc-only in M2a; it has no feed to fetch');
    },
    async extract(input: ExtractInput): Promise<ExtractResult> {
      const videoId = parseYoutubeVideoId(input.url);
      if (!videoId) return unavailable(null);

      let track: RawSubtitleTrack | null;
      try {
        track = await fetchSubtitle(videoId);
      } catch (err) {
        // Transient → let pg-boss retry. Anything else → a missing/blocked subtitle
        // is normal, not a pipeline error: degrade and continue (spec §7 caption layer).
        if (err instanceof TransientFetchError) throw err;
        return unavailable(null);
      }

      if (!track || track.cues.length === 0) {
        return unavailable(track?.durationSeconds ?? null, track?.title ?? null);
      }

      const segments = cuesToSegments(track.cues);
      const rawContent = segments.map((s) => s.text).join('\n').trim();
      if (rawContent.length === 0) return unavailable(track.durationSeconds, track.title);

      return {
        rawContent,
        ...(track.title ? { title: track.title } : {}),
        contentType: 'video',
        transcriptStatus: 'present',
        transcriptSegments: segments,
        videoDuration: track.durationSeconds,
      };
    },
  };
}

// yt-dlp backend (spec §3). Error classification now lives in classifyYtdlpError inside
// fetchYoutubeTrack — there is no youtubei.js error object to inspect here anymore.
const fetchYoutubeSubtitle: FetchYoutubeSubtitle = (videoId) => fetchYoutubeTrack(videoId);

export const youtubeAdapter: SourceAdapter = createYoutubeAdapter(fetchYoutubeSubtitle);
```

- [ ] **Step 2: Trim `youtube.test.ts`**

Remove the `import { Utils } from 'youtubei.js'` line and the entire `describe('INNERTUBE_OPTIONS', ...)` and `describe('isDefinitiveYoutubeError', ...)` blocks, plus `INNERTUBE_OPTIONS`/`isDefinitiveYoutubeError` from the import list. Keep `parseYoutubeVideoId`, the `youtube adapter extract` block, and the `RawSubtitleTrack` type import. The remaining import becomes:

```typescript
import { describe, expect, test } from 'vitest';
import {
  parseYoutubeVideoId,
  createYoutubeAdapter,
  type RawSubtitleTrack,
} from '../../src/sources/youtube.js';
import { TransientFetchError } from '../../src/sources/types.js';
```

- [ ] **Step 3: Delete `youtube-session.ts` and its test**

```bash
git rm packages/core/src/sources/youtube-session.ts packages/core/test/sources/youtube-session.test.ts
```

- [ ] **Step 4: Run the affected suites**

Run: `pnpm --filter @benkyou/core test youtube ytdlp`
Expected: PASS — adapter cases green via the new delegate; no `youtubei.js` or `youtube-session` import remains in `src/`.

- [ ] **Step 5: Verify no dangling references**

Run:
```bash
grep -rn "youtube-session\|INNERTUBE_OPTIONS\|isDefinitiveYoutubeError\|resolveYoutubeAudioUrl\|isPotokenEnabled\|withYoutubeSession" packages apps --include='*.ts' | grep -v node_modules
```
Expected: **no output.** (All consumers rewired.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sources/youtube.ts packages/core/test/sources/youtube.test.ts
git commit -m "refactor(youtube): delegate adapter to yt-dlp; retire youtube-session"
```

---

### Task 13: Drop the `youtubei.js` dependency; full-suite verification

**Files:**
- Modify: `packages/core/package.json` (remove `youtubei.js`)
- Delete: `packages/core/test/sources/youtube-fetch.int.test.ts` (live youtubei.js adapter probe — superseded by the Task 1 yt-dlp spike)

- [ ] **Step 1: Delete the superseded live adapter test**

```bash
git rm packages/core/test/sources/youtube-fetch.int.test.ts
```

- [ ] **Step 2: Remove the dependency**

In `packages/core/package.json`, delete the line:
```json
    "youtubei.js": "^17.0.1",
```

- [ ] **Step 3: Re-resolve the lockfile**

Run: `pnpm install`
Expected: lockfile updates; `youtubei.js` no longer in `pnpm-lock.yaml`.

- [ ] **Step 4: Confirm youtubei.js is fully gone**

Run:
```bash
grep -rn "youtubei.js" packages apps --include='*.ts' | grep -v node_modules; \
grep -n "youtubei.js" pnpm-lock.yaml || echo "lockfile clean"
```
Expected: no `.ts` matches; lockfile clean.

- [ ] **Step 5: Run the full pre-submit gate (CLAUDE.md)**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm build
pnpm test
```
Expected: all green. (`pnpm build` is non-negotiable — it exercises the client/server bundle boundary that typecheck/vitest miss.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "chore(youtube): drop youtubei.js dependency"
```

---

### Task 14: Docker image — add `python3` + `yt-dlp` to the worker

No TDD (spec §9 — version selection + Dockerfile are bump-on-break, not test-driven).

**Files:**
- Modify: `Dockerfile.worker` (runtime stage `apk add` layer)

- [ ] **Step 1: Add python3 + yt-dlp (+ pot plugin if `SIDECAR=keep`) to the runtime stage**

In `Dockerfile.worker`, replace the runtime-stage line:
```dockerfile
RUN apk add --no-cache ffmpeg
```
with (pin to the versions Task 1's spike validated — record the exact tags; `pip install --break-system-packages` is required on Alpine's externally-managed python):
```dockerfile
# yt-dlp owns the YouTube extraction surface (spec §2). Pin-and-bump: YouTube can break
# yt-dlp within days, so a pinned binary in a rarely-rebuilt image can rot — bump these
# tags on break (spec §10). Do NOT `pip install -U` at container start (reproducibility).
RUN apk add --no-cache ffmpeg python3 py3-pip \
  && pip install --no-cache-dir --break-system-packages \
       "yt-dlp==<PIN_FROM_SPIKE>" \
       "bgutil-ytdlp-pot-provider==<PIN_FROM_SPIKE>"
```

> **SIDECAR=drop variant:** omit the `bgutil-ytdlp-pot-provider` line — the plugin is only needed when the pot sidecar is in use.

- [ ] **Step 2: Build the worker image and smoke-test the binary**

```bash
docker build -f Dockerfile.worker -t benkyou-worker:ytdlp-test .
docker run --rm benkyou-worker:ytdlp-test yt-dlp --version
```
Expected: prints the pinned yt-dlp version (binary present on PATH in the runtime image).

- [ ] **Step 3: Commit**

```bash
git add Dockerfile.worker
git commit -m "build(worker): install python3 + pinned yt-dlp (+ pot plugin)"
```

---

### Task 15: `docker-compose.yml` — settle the sidecar per the spike

No TDD. **This task's content is decided by `SIDECAR` from Task 1.**

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1 (SIDECAR=keep): leave the sidecar; confirm wiring**

If `SIDECAR=keep`, the existing `potoken-provider` service and the worker's `POTOKEN_PROVIDER_URL: http://potoken-provider:4416` stay as-is. Confirm the pinned image tag matches what the Task 1 spike used; bump if needed. No structural change.

- [ ] **Step 1 (SIDECAR=drop): remove the sidecar service + env**

If `SIDECAR=drop`, delete the entire `potoken-provider:` service block and remove the `POTOKEN_PROVIDER_URL` line from the `worker.environment` map. **Then** update the gate body in `packages/core/src/sources/ytdlp.ts` (`isYoutubeBackendEnabled`) to the drop form:
```typescript
export function isYoutubeBackendEnabled(): boolean {
  return env.DEPLOY_MODE !== 'serverless';
}
```
and remove the `bgutil-ytdlp-pot-provider` pip line from `Dockerfile.worker` (if not already removed in Task 14). Re-run the gate unit test:
```bash
pnpm --filter @benkyou/core test ytdlp
```
Expected: the `isYoutubeBackendEnabled` cases reflect the drop form (docker → enabled regardless of `POTOKEN_PROVIDER_URL`). Update the Task 6 test's "POTOKEN unset → disabled" case accordingly (drop form → that case becomes "docker → enabled").

> **Note (SIDECAR=drop):** `pipeline/status.ts:getPotokenHealth` and the `credential-status.ts` YouTube row key off `POTOKEN_PROVIDER_URL`; with it unset they report `configured:false` / `'off'`, which is correct (spec §8 — the health row is removed when the sidecar is dropped). No further change needed.

- [ ] **Step 2: Validate compose**

```bash
docker compose config >/dev/null && echo "compose valid"
```
Expected: `compose valid` (no reference to a removed service if dropped).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml packages/core/src/sources/ytdlp.ts Dockerfile.worker packages/core/test/sources/ytdlp.test.ts
git commit -m "build(compose): settle PoToken sidecar per spike (SIDECAR decision)"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §0 problem / §6 spike-first gate | Task 1 (live spike, records SIDECAR/AUDIO/POT decisions) |
| §1 full retirement (delete youtube-session, shrink potoken-client, drop dep, no schema change) | Tasks 9, 12, 13 |
| §2 worker subprocess (arg array, canonical URL, Docker python3+yt-dlp, serverless degrade) | Tasks 5, 6, 14; gate in 6/7/10 |
| §3 module shape (ytdlp.ts surface, DI `run`, keep adapter shell) | Tasks 2–8, 12 |
| §4.1 captions (manual→auto→none, json3 parsing, accept auto) | Tasks 2, 4, 7 |
| §4.2 audio/Whisper byte path | Tasks 8, 11 |
| §5 capability gate guards BOTH consumers | Tasks 6, 7 (gate test), 10 |
| §7 error classification + per-stage terminal mapping | Tasks 3, 7 |
| §8 observability (relocate pingPotokenSidecar, credential row, degrade logging) | Tasks 9, 7/12 (console.warn), 15 note |
| §9 testing strategy (pure TDD, terminal mapping, gate, wrappers, live spike) | Tasks 1–8 |
| §10 risks (pin-and-bump, single chokepoint, both code paths cheap) | Tasks 6, 14, 15 |

All spec sections map to at least one task.

**2. Placeholder scan**

The only intentional `<PIN_FROM_SPIKE>` / `[SPIKE-SELECTED]` markers are in Tasks 14/15/6 — these are the spec's *explicitly deferred* bump-on-break version pins and the spike-gated gate form (spec §6/§9 say version selection is not test-driven and the sidecar decision is "a spike outcome, not decided now"). Every code step contains complete, runnable code. No vague "add error handling" / "write tests for the above" remain.

**3. Type consistency**

`RawCue` / `RawSubtitleTrack` are defined in `youtube.ts` and imported type-only into `ytdlp.ts` (no runtime cycle — `youtube.ts` value-imports `fetchYoutubeTrack`, `ytdlp.ts` type-imports back). `YtdlpRun`, `YtdlpResult`, `YtdlpInfo`, `YtdlpMode`, `YtdlpArgsOpts`, `CaptionSelection`, `Json3Event` are defined in `ytdlp.ts` and used consistently across Tasks 2–8. `isYoutubeWhisperHandoff`'s renamed param (`audioHandoffEnabled`) keeps a single-boolean signature, so its existing unit test (booleans) still passes. `fetchYoutubeTrack` returns `RawSubtitleTrack` (never null), and `createYoutubeAdapter` already handles both null and empty-cues → `unavailable`. `transcribeItem`'s new `isYoutubeTranscribeSource` seam returns `string | null`, matching the call site.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-25-youtube-ytdlp-backend.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Note: **Task 1 (the live spike) must be run by you / on a box with network + yt-dlp + the sidecar** before the build tasks — it is the kill-switch and sets the SIDECAR/AUDIO/POT decisions the later tasks depend on.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**

---

## Task 1 spike result (RESOLVED 2026-06-25)

**Verdict: BUILD. Migration premise validated.** The exact §0 known-blocked video (`7qO8-kx3gW8`, manual captions `[zh-Hans, zh-Hant]`, blocked through youtubei.js `get_transcript` + SABR) now succeeds end-to-end through yt-dlp — **without** the PoToken sidecar.

**Matrix** (`yt-dlp 2026.06.09`, standalone `yt-dlp_linux` binary; outbound via host proxy):

| Probe | Without sidecar | With sidecar |
|---|---|---|
| 1 — metadata (`-J`) | ✅ title + `duration=1951` | not needed (without-sidecar already passes) |
| 2 — json3 captions (zh-Hans) | ✅ 910 events, real text | not needed |
| 3 — bestaudio (`-f bestaudio`) | ✅ 26.77 MiB webm, format `251` | not needed |

Formal gated test (`packages/core/test/sources/ytdlp-spike.int.test.ts`, `YTDLP_LIVE=1`): **3/3 passed (9.94s)**.

**Decisions:** `SIDECAR=drop` · `AUDIO=in-scope` · `POT_EXTRACTOR_ARG=N/A`.

**Decision rule applied (spec §6):** without-sidecar passed captions + metadata (+ audio) → `SIDECAR=drop` (minimal column). Probe 3 passed → `AUDIO=in-scope`. No sidecar → no pot extractor-arg in production.

**Implementation notes for downstream tasks:**
- **Task 6** — use the **drop-form** gate: `isYoutubeBackendEnabled() { return env.DEPLOY_MODE !== 'serverless'; }`. The Task 6 unit test's "docker + POTOKEN unset → disabled" case must become "docker → **enabled** regardless of `POTOKEN_PROVIDER_URL`". `isYoutubeAudioEnabled()` returns `true` (AUDIO in-scope).
- **Task 10** — the call site stays `isYoutubeBackendEnabled() && isYoutubeAudioEnabled()` (both true in docker) → handoff active. Note: `extract-youtube-handoff.int.test.ts` no longer needs `POTOKEN_PROVIDER_URL` stubbed for the gate (drop-form ignores it), but leaving the stub is harmless.
- **Tasks 8, 11** — full-scope (audio path built; no descope shortcut).
- **Task 14** — pin `yt-dlp==2026.06.09`; **omit** the `bgutil-ytdlp-pot-provider` pip line. Keep `python3 py3-pip ffmpeg`.
- **Task 15** — drop variant: remove `potoken-provider` service + `POTOKEN_PROVIDER_URL` from worker env; apply the drop-form gate (same as Task 6).
- **Observation (not a scope change):** the spike emitted `WARNING: No supported JavaScript runtime could be found … some formats may be missing` (deno not installed) yet succeeded via the `android_vr` client. For this video, no JS runtime was required. If future videos need it, adding `deno` to the worker image is a bump-on-break follow-up, not part of this plan.
- **Observation:** `pingPotokenSidecar`/`getPotokenHealth`/`credential-status` YouTube row key off `POTOKEN_PROVIDER_URL`; unset → `configured:false`/`'off'`, which is correct once the sidecar is dropped (spec §8). `pingPotokenSidecar` is still relocated (Task 9) — it's generic sidecar health, retained.
