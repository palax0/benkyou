import type { TranscriptSegment } from '../sources/types';
import type { WhisperConfig } from '../settings';
import { recordUsage, type UsageContext } from './usage';

interface VerboseJson {
  segments?: { start: number; end: number; text: string; speaker?: string }[];
  text?: string;
}

// OpenAI Whisper-API-compatible POST /audio/transcriptions, multipart form.
// verbose_json yields per-segment timestamps; endpoints without them degrade to a
// single chunk-granular segment. speaker is filled only when the endpoint returns it.
export async function transcribeChunk(
  cfg: WhisperConfig, file: Blob, chunkSeconds: number,
): Promise<TranscriptSegment[]> {
  const form = new FormData();
  form.set('file', file, 'chunk.ogg');
  form.set('model', cfg.model);
  form.set('response_format', 'verbose_json');
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : undefined,
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper transcription failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as VerboseJson;
  if (json.segments?.length) {
    return json.segments.map((s) => ({
      start: s.start, end: s.end, text: s.text,
      ...(s.speaker ? { speaker: s.speaker } : {}),
    }));
  }
  // No timestamps → one chunk-granular segment spanning the whole chunk.
  return [{ start: 0, end: chunkSeconds, text: (json.text ?? '').trim() }];
}

export async function transcribeRecorded(args: {
  cfg: WhisperConfig; ctx: UsageContext; file: Blob; durationSec: number;
}): Promise<{ segments: TranscriptSegment[] }> {
  const segments = await transcribeChunk(args.cfg, args.file, args.durationSec);
  await recordUsage(args.ctx, {
    kind: 'transcription', model: args.cfg.model,
    inputTokens: null, outputTokens: null, totalTokens: null, durationSeconds: args.durationSec,
  });
  return { segments };
}
