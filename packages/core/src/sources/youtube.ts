import type { ExtractInput, ExtractResult, SourceAdapter, TranscriptSegment } from './types';
import { TransientFetchError } from './types';
import { Innertube } from 'youtubei.js';

// Internal contract between the fragile network edge and the pure transform.
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
  title?: string | null; // video title from metadata; refines a URL-placeholder item title
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
    // /shorts/<id>, /embed/<id>, /v/<id>
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
        // is normal, not a pipeline error: degrade and continue (design §2).
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

let innertube: Promise<Innertube> | null = null;
function getInnertube(): Promise<Innertube> {
  // Lazy singleton: Innertube.create() does a network handshake; build it once.
  innertube ??= Innertube.create({ retrieve_player: false });
  return innertube;
}

const fetchYoutubeSubtitle: FetchYoutubeSubtitle = async (videoId) => {
  let info;
  try {
    const yt = await getInnertube();
    info = await yt.getInfo(videoId);
  } catch (err) {
    // Network/handshake failures are transient → retry. (A private/removed video
    // also throws here; treating it as transient costs at most pipeline_max_attempts
    // retries before the item degrades on the dispatcher's non-transient path. We
    // keep the simple rule rather than string-matching youtubei.js error messages.)
    throw new TransientFetchError(err instanceof Error ? err.message : String(err));
  }

  // basic_info.duration is number | undefined per youtubei.js v17 MediaInfo types.
  const durationSeconds = info.basic_info.duration ?? null;
  const title = info.basic_info.title ?? null;

  let transcript;
  try {
    transcript = await info.getTranscript();
  } catch {
    // No transcript panel = definitively no captions → degrade.
    return { durationSeconds, title, cues: [] };
  }

  // Shape (v17): TranscriptInfo.transcript → Transcript (content: TranscriptSearchPanel | null)
  // → content.body → TranscriptSegmentList (initial_segments: ObservedArray<TranscriptSegment | TranscriptSectionHeader>)
  // Both segment types share start_ms: string, end_ms: string, snippet: Text.
  // Text.toString() returns the plain string (handles both .text and runs forms).
  const segments = transcript.transcript.content?.body?.initial_segments ?? [];
  const cues: RawCue[] = segments
    .map((seg) => {
      const text = seg.snippet.toString();
      // start_ms / end_ms are millisecond strings in youtubei.js v17.
      const start = Number(seg.start_ms) / 1000;
      const end = Number(seg.end_ms) / 1000;
      return { start, end, text };
    })
    .filter((c) => c.text.trim().length > 0);

  return { durationSeconds, title, cues };
};

export const youtubeAdapter: SourceAdapter = createYoutubeAdapter(fetchYoutubeSubtitle);
