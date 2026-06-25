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
