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
