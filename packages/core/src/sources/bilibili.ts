import type { ExtractInput, ExtractResult, SourceAdapter } from './types';
import { TransientFetchError } from './types';
import type { FetchYoutubeSubtitle, RawSubtitleTrack } from './youtube';

const BV = /^BV[0-9A-Za-z]{10}$/;

export function parseBilibiliId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host !== 'bilibili.com' && !host.endsWith('.bilibili.com')) return null;
  const m = u.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/);
  const id = m?.[1] ?? '';
  return BV.test(id) ? id : null;
}

// Same fetcher contract as YouTube: null = definitive miss; throw TransientFetchError
// = transient. (login-required captions resolve to null → 'unavailable', design §2.)
export type FetchBilibiliSubtitle = (bvid: string) => Promise<RawSubtitleTrack | null>;

function unavailable(durationSeconds: number | null): ExtractResult {
  return {
    rawContent: null,
    contentType: 'video',
    transcriptStatus: 'unavailable',
    transcriptSegments: null,
    videoDuration: durationSeconds,
  };
}

export function createBilibiliAdapter(fetchSubtitle: FetchBilibiliSubtitle): SourceAdapter {
  return {
    type: 'bilibili',
    async fetchItems(): Promise<never> {
      throw new Error('bilibili adapter is adhoc-only in M2a; it has no feed to fetch');
    },
    async extract(input: ExtractInput): Promise<ExtractResult> {
      const bvid = parseBilibiliId(input.url);
      if (!bvid) return unavailable(null);
      let track: RawSubtitleTrack | null;
      try {
        track = await fetchSubtitle(bvid);
      } catch (err) {
        if (err instanceof TransientFetchError) throw err;
        return unavailable(null);
      }
      if (!track || track.cues.length === 0) return unavailable(track?.durationSeconds ?? null);
      const segments = track.cues.map((c) => ({
        start: c.start,
        end: c.end,
        text: c.text,
        ...(c.speaker ? { speaker: c.speaker } : {}),
      }));
      const rawContent = segments.map((s) => s.text).join('\n').trim();
      if (rawContent.length === 0) return unavailable(track.durationSeconds);
      return {
        rawContent,
        contentType: 'video',
        transcriptStatus: 'present',
        transcriptSegments: segments,
        videoDuration: track.durationSeconds,
      };
    },
  };
}

// Network fetch wired in Task 7; default reports "no captions" so the adapter is
// registrable and degrades cleanly until then.
const fetchBilibiliSubtitle: FetchBilibiliSubtitle = async () => null;
export const bilibiliAdapter: SourceAdapter = createBilibiliAdapter(fetchBilibiliSubtitle);
// Re-export the YouTube fetcher type so callers needn't reach into youtube.ts.
export type { FetchYoutubeSubtitle };
