import type { ExtractInput, ExtractResult, SourceAdapter } from './types';
import { TransientFetchError } from './types';
import type { FetchYoutubeSubtitle, RawCue, RawSubtitleTrack } from './youtube';
import { mixinKey, encodeWbi } from './bilibili-wbi';

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
export type FetchBilibiliSubtitle = (bvid: string, opts?: { sessdata?: string }) => Promise<RawSubtitleTrack | null>;

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
        track = await fetchSubtitle(bvid, { sessdata: input.credentials?.bilibiliSessdata });
      } catch (err) {
        if (err instanceof TransientFetchError) throw err;
        return unavailable(null);
      }
      if (!track || track.cues.length === 0) {
        return unavailable(track?.durationSeconds ?? null, track?.title ?? null);
      }
      const segments = track.cues.map((c) => ({
        start: c.start,
        end: c.end,
        text: c.text,
        ...(c.speaker ? { speaker: c.speaker } : {}),
      }));
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

const BILI_HEADERS = {
  'user-agent': 'benkyou/0.1 (+https://github.com/benkyou)',
  referer: 'https://www.bilibili.com/',
};

// Classify a bilibili HTTP status. 5xx = transient (retry); 4xx = the resource can't
// be read anonymously (private / removed / login-walled) = a definitive miss → degrade.
// Only the adapter's TransientFetchError path retries; a plain throw degrades (design §2).
export function biliStatusDisposition(status: number): 'ok' | 'transient' | 'miss' {
  if (status >= 500) return 'transient';
  if (status >= 400) return 'miss';
  return 'ok';
}

async function biliJson<T>(url: string, sessdata?: string): Promise<T> {
  const headers: Record<string, string> = { ...BILI_HEADERS };
  if (sessdata) headers.cookie = `SESSDATA=${sessdata}`;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    // Network failure is genuinely transient → retry.
    throw new TransientFetchError(`bilibili network: ${err instanceof Error ? err.message : String(err)}`);
  }
  const disposition = biliStatusDisposition(res.status);
  if (disposition === 'transient') throw new TransientFetchError(`bilibili ${res.status}`);
  if (disposition === 'miss') throw new Error(`bilibili ${res.status}`); // → adapter degrades
  return (await res.json()) as T;
}

async function getMixinKey(sessdata?: string): Promise<string> {
  const nav = await biliJson<{ data?: { wbi_img?: { img_url?: string; sub_url?: string } } }>(
    'https://api.bilibili.com/x/web-interface/nav', sessdata,
  );
  const pick = (u?: string): string => (u ? (u.split('/').pop() ?? '').split('.')[0] ?? '' : '');
  const imgKey = pick(nav.data?.wbi_img?.img_url);
  const subKey = pick(nav.data?.wbi_img?.sub_url);
  if (!imgKey || !subKey) throw new TransientFetchError('bilibili nav: wbi keys missing');
  return mixinKey(imgKey + subKey);
}

const fetchBilibiliSubtitle: FetchBilibiliSubtitle = async (bvid, opts) => {
  const sessdata = opts?.sessdata;
  // 1) bvid → cid + duration + title
  const view = await biliJson<{
    data?: { cid?: number; duration?: number; title?: string };
  }>(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, sessdata);
  const cid = view.data?.cid;
  const durationSeconds = view.data?.duration ?? null;
  const title = view.data?.title ?? null;
  if (!cid) return null; // unplayable / removed → definitive miss

  // 2) wbi-signed player v2 → subtitle list (login-free subtitles only, design §2)
  const mk = await getMixinKey(sessdata);
  const signed = encodeWbi({ bvid, cid }, mk, Math.floor(Date.now() / 1000));
  const qs = new URLSearchParams(signed).toString();
  const player = await biliJson<{
    data?: { subtitle?: { subtitles?: Array<{ subtitle_url?: string }> } };
  }>(`https://api.bilibili.com/x/player/wbi/v2?${qs}`, sessdata);

  const first = player.data?.subtitle?.subtitles?.[0]?.subtitle_url;
  if (!first) {
    // Distinguish logged-out from genuinely caption-less (design §5 lightweight reason).
    console.warn(`[bilibili] ${bvid} no subtitles${sessdata ? '' : ' (anonymous — try SESSDATA)'}`);
    return { durationSeconds, title, cues: [] };
  }
  const url = first.startsWith('//') ? `https:${first}` : first;

  // 3) subtitle JSON → timed cues
  const sub = await biliJson<{ body?: Array<{ from?: number; to?: number; content?: string }> }>(url, sessdata);
  const cues: RawCue[] = (sub.body ?? [])
    .map((c) => ({ start: c.from ?? 0, end: c.to ?? 0, text: c.content ?? '' }))
    .filter((c) => c.text.trim().length > 0);
  return { durationSeconds, title, cues };
};

export const bilibiliAdapter: SourceAdapter = createBilibiliAdapter(fetchBilibiliSubtitle);
// Re-export the YouTube fetcher type so callers needn't reach into youtube.ts.
export type { FetchYoutubeSubtitle };
