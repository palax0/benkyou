import { spawn } from 'node:child_process';
import pLimit from 'p-limit';
import type { TranscriptSegment } from '../sources/types';
import type { TranscribeView } from './transcribe-store';
import { downloadToTmp, probeRemoteDurationSec } from './media-probe';
import { transcribeRecorded } from '../ai/whisper';
import { buildWhisperConfig, getUserSettings } from '../settings';
import { parseYoutubeVideoId } from '../sources/youtube';
import { downloadYoutubeAudio } from '../sources/ytdlp';

const WINDOW_SEC = 600;   // 10-min chunks keep each upload under the 25 MB Whisper limit
const OVERLAP_SEC = 5;
const WHISPER_CONCURRENCY = 3; // unbounded Promise.all on ~18 chunks trips endpoint rate limits

export function planChunks(durationSec: number): { index: number; start: number; end: number }[] {
  if (durationSec <= WINDOW_SEC) return [{ index: 0, start: 0, end: Math.max(durationSec, 0) }];
  const out: { index: number; start: number; end: number }[] = [];
  let start = 0; let index = 0;
  while (start < durationSec) {
    const end = Math.min(start + WINDOW_SEC, durationSec);
    out.push({ index, start, end });
    if (end >= durationSec) break;
    index += 1;
    start = end - OVERLAP_SEC;
  }
  return out;
}

// Merge by ABSOLUTE timestamp. Offset each chunk's segments by its start; in the overlap
// region drop later-chunk segments whose absolute start falls before the previous chunk's
// effective end. v1 does NO fuzzy text alignment (spec §5.5).
export function mergeSegments(
  chunks: { start: number; segments: TranscriptSegment[] }[],
): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let prevEnd = 0;
  for (const chunk of chunks) {
    for (const seg of chunk.segments) {
      const abs = { ...seg, start: seg.start + chunk.start, end: seg.end + chunk.start };
      if (abs.start < prevEnd) continue; // overlap duplicate
      out.push(abs);
    }
    if (out.length) prevEnd = out[out.length - 1]!.end;
  }
  return out;
}

function ffmpegSliceToOgg(srcPath: string, start: number, end: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error', '-ss', String(start), '-to', String(end), '-i', srcPath,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-f', 'ogg', 'pipe:1',
    ];
    const proc = spawn('ffmpeg', args);
    const bufs: Buffer[] = []; let err = '';
    proc.stdout.on('data', (d) => bufs.push(d));
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject);
    // Buffer.concat returns Buffer<ArrayBufferLike> (may be SharedArrayBuffer); Blob
    // constructor requires a real ArrayBuffer. Slice the underlying buffer to force
    // a concrete ArrayBuffer copy.
    proc.on('close', (code) => {
      if (code === 0) {
        const concat = Buffer.concat(bufs);
        resolve(concat.buffer.slice(concat.byteOffset, concat.byteOffset + concat.byteLength) as ArrayBuffer);
      } else {
        reject(new Error(`ffmpeg ${code}: ${err.slice(0, 500)}`));
      }
    });
  });
}

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
