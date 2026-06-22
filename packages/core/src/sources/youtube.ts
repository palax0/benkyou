import type { ExtractInput, ExtractResult, SourceAdapter, TranscriptSegment } from './types';
import { TransientFetchError } from './types';
import { Innertube, Utils } from 'youtubei.js';
import { withYoutubeSession, isYoutubeTokenExpiryError, YoutubeTokenExpiryError } from './youtube-session';

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

// youtubei.js raises InnertubeError (incl. ParsingError / MissingParamError /
// OAuth2Error) and PlayerError for content/playability problems — the video is
// unavailable / private / removed / undecipherable. Those are DEFINITIVE misses:
// degrade to 'unavailable', do not burn the retry budget. A raw network / handshake
// failure (or a SessionError) is none of these → transient → pg-boss retries.
export function isDefinitiveYoutubeError(err: unknown): boolean {
  return err instanceof Utils.InnertubeError || err instanceof Utils.PlayerError;
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

// retrieve_player MUST stay true. With retrieve_player:false, YouTube reports some
// playable, captioned videos as playability=UNPLAYABLE ("Video unavailable / The page
// needs to be reloaded") — which hides the caption tracks and degrades the item to
// 'unavailable' even though it has subtitles. Retrieving the player costs an extra
// handshake but is required for playability to resolve to OK. (Regression-tested.)
export const INNERTUBE_OPTIONS = { retrieve_player: true } as const;

// One attempt against a given session. Returns a track (possibly empty cues = degrade).
// Throws TransientFetchError (network/5xx → retry) or YoutubeTokenExpiryError (→ withYoutubeSession
// refreshes once). A definitive content error degrades in place (empty cues + whatever
// duration/title we have) so Layer 2 (§4.2) can still fire on the known duration.
async function fetchOnce(yt: Innertube, videoId: string): Promise<RawSubtitleTrack> {
  let info;
  try {
    info = await yt.getInfo(videoId);
  } catch (err) {
    if (isDefinitiveYoutubeError(err)) return { durationSeconds: null, title: null, cues: [] };
    throw new TransientFetchError(err instanceof Error ? err.message : String(err));
  }

  const durationSeconds = info.basic_info.duration ?? null;
  const title = info.basic_info.title ?? null;

  if (info.playability_status?.status && info.playability_status.status !== 'OK') {
    console.warn(
      `[youtube] ${videoId} degraded: playability=${info.playability_status.status}` +
        ` reason=${JSON.stringify(info.playability_status.reason ?? null)}`,
    );
    return { durationSeconds, title, cues: [] };
  }

  let transcript;
  try {
    transcript = await info.getTranscript();
  } catch (err) {
    // Anti-bot hardening surfaces here (get_transcript 400 without a valid PoToken).
    // Signal expiry so withYoutubeSession can refresh once; carry duration/title so an
    // exhausted refresh still degrades WITH a duration (Layer 2 §4.2). Genuinely
    // caption-less videos throw a non-expiry error → degrade quietly here.
    if (isYoutubeTokenExpiryError(err)) {
      throw new YoutubeTokenExpiryError({ durationSeconds, title, cues: [] });
    }
    console.warn(
      `[youtube] ${videoId} degraded: getTranscript failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { durationSeconds, title, cues: [] };
  }

  const segments = transcript.transcript.content?.body?.initial_segments ?? [];
  const cues: RawCue[] = segments
    .map((seg) => {
      const text = seg.snippet.toString();
      const start = Number(seg.start_ms) / 1000;
      const end = Number(seg.end_ms) / 1000;
      return { start, end, text };
    })
    .filter((c) => c.text.trim().length > 0);

  return { durationSeconds, title, cues };
}

const fetchYoutubeSubtitle: FetchYoutubeSubtitle = async (videoId) => {
  try {
    return await withYoutubeSession((yt) => fetchOnce(yt, videoId));
  } catch (err) {
    if (err instanceof TransientFetchError) throw err; // adapter rethrows → pg-boss retries
    // Refresh exhausted (or unexpected): degrade, keeping any duration we resolved so
    // Layer 2 can still hand off on it (§4.2).
    if (err instanceof YoutubeTokenExpiryError) {
      console.warn(`[youtube] ${videoId} degraded: PoToken refresh exhausted`);
      return err.partial;
    }
    return { durationSeconds: null, title: null, cues: [] };
  }
};

export const youtubeAdapter: SourceAdapter = createYoutubeAdapter(fetchYoutubeSubtitle);
