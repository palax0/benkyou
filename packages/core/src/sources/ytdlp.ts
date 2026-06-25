import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../config/env';
import { TransientFetchError } from './types';
import type { RawCue, RawSubtitleTrack } from './youtube';

export interface Json3Seg {
  utf8?: string;
}
export interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Seg[];
}

export interface YtdlpInfo {
  title?: string | null;
  duration?: number | null;
  subtitles?: Record<string, unknown[]>;
  automatic_captions?: Record<string, unknown[]>;
}

export type CaptionSelection = { lang: string; kind: 'manual' | 'auto' } | null;

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
  /not available in your country|blocked it in your country|geo.?block|geo.?restrict/i,
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

export interface YtdlpResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type YtdlpRun = (args: string[]) => Promise<YtdlpResult>;

// Production runner: spawn with an arg ARRAY (no shell, spec §2). Resolves with the
// exit code + captured streams (never rejects on nonzero — callers classify the code);
// rejects only when the binary itself can't start (ENOENT).
export const runYtdlp: YtdlpRun = (args) =>
  new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d; });
    proc.stderr.on('data', (d: Buffer) => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', (code: number | null) => resolve({ code: code ?? -1, stdout, stderr }));
  });

// Single capability chokepoint (spec §5/§10). Serverless has no subprocess, so it is
// always off. SIDECAR=drop (Task 1 spike): plain yt-dlp reaches YouTube with no PoToken
// sidecar, so docker mode is enabled unconditionally — POTOKEN_PROVIDER_URL is not read.
export function isYoutubeBackendEnabled(): boolean {
  return env.DEPLOY_MODE !== 'serverless';
}

// AUDIO=in-scope (Task 1 spike Probe 3 passed). Consumed by the Layer-2 handoff gate.
export function isYoutubeAudioEnabled(): boolean {
  return true;
}

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
