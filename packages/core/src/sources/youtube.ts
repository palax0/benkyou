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
