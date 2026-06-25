import { Innertube } from 'youtubei.js';
import { env } from '../config/env';
import { INNERTUBE_OPTIONS, type RawSubtitleTrack } from './youtube';
import { TransientFetchError } from './types';
import { getPlatformCredential, upsertPlatformCredential } from './platform-credentials';

interface GetPotResponse {
  po_token?: string;
}

// Inlined from the retired PoToken client (deleted in Task 9). youtube-session.ts
// itself is retired in Task 12 — keeping this here avoids a dangling import in the interim.
async function fetchAnonymousPoToken(providerUrl: string, visitorData: string): Promise<string> {
  const base = providerUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/get_pot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content_binding: visitorData }),
  });
  if (!res.ok) throw new Error(`PoToken provider /get_pot failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as GetPotResponse;
  if (!json.po_token) throw new Error('PoToken provider response missing po_token');
  return json.po_token;
}

const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

export interface SessionToken { poToken: string; visitorData: string; }

// Carries the partial track (duration/title, empty cues) so that when token refresh is
// exhausted the caller can still degrade WITH a known duration → Layer 2 (§4.2) can fire.
export class YoutubeTokenExpiryError extends Error {
  constructor(public partial: RawSubtitleTrack) {
    super('YouTube token expiry');
    this.name = 'YoutubeTokenExpiryError';
  }
}

export function isPotokenEnabled(): boolean {
  return Boolean(env.POTOKEN_PROVIDER_URL);
}

// Token-expiry "smell" (§0): withheld stream ("No valid URL to decipher") or a 403.
// TransientFetchError is explicitly NOT expiry (network/5xx → retry).
//
// get_transcript is the exception: YouTube's bot detection now 100%-blocks that endpoint
// (HTTP 400 FAILED_PRECONDITION) regardless of PoToken — refreshing cannot fix it, so it
// must NOT count as expiry or every captioned video burns a wasted BotGuard refresh.
// (Confirmed upstream: github.com/LuanRT/YouTube.js#1102. Real fix is the yt-dlp backend.)
export function isYoutubeTokenExpiryError(err: unknown): boolean {
  if (err instanceof YoutubeTokenExpiryError) return true;
  if (err instanceof TransientFetchError) return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (/get_transcript/.test(msg)) return false;
  return /\b40[03]\b/.test(msg) || /decipher/i.test(msg);
}

export interface SessionDeps {
  enabled: boolean;
  loadToken: () => Promise<SessionToken | null>;
  refreshToken: () => Promise<SessionToken>;
  buildInnertube: (tok: SessionToken | null) => Promise<Innertube>;
}

// ── production deps ────────────────────────────────────────────────────────
async function loadTokenFromCache(): Promise<SessionToken | null> {
  const row = await getPlatformCredential('youtube');
  if (!row?.secret) return null;
  const meta = row.meta as { visitorData?: string; fetchedAt?: number } | null;
  if (!meta?.visitorData || typeof meta.fetchedAt !== 'number') return null;
  if (Date.now() - meta.fetchedAt > TOKEN_TTL_MS) return null;
  return { poToken: row.secret, visitorData: meta.visitorData };
}

// Collapse concurrent calls onto one in-flight promise; the next call after it settles
// starts fresh. The 6h cache handles steady-state dedup — this only closes the cold-start /
// post-expiry window where every queued job misses the cache at once and would otherwise
// each spawn a BotGuard run + sidecar fetch.
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        return await fn();
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}

const refreshTokenFromSidecar = singleFlight(async (): Promise<SessionToken> => {
  const providerUrl = env.POTOKEN_PROVIDER_URL;
  if (!providerUrl) throw new TransientFetchError('POTOKEN_PROVIDER_URL unset during refresh');
  // A no-player Innertube yields visitor_data cheaply (design §2 step 1).
  const probe = await Innertube.create({ retrieve_player: false });
  const visitorData = probe.session.context.client.visitorData ?? '';
  const poToken = await fetchAnonymousPoToken(providerUrl, visitorData);
  await upsertPlatformCredential('youtube', { secret: poToken, meta: { visitorData, fetchedAt: Date.now() } });
  return { poToken, visitorData };
});

async function buildInnertubeWithToken(tok: SessionToken | null): Promise<Innertube> {
  if (!tok) return Innertube.create(INNERTUBE_OPTIONS);
  return Innertube.create({ ...INNERTUBE_OPTIONS, po_token: tok.poToken, visitor_data: tok.visitorData });
}

function productionDeps(): SessionDeps {
  return {
    enabled: isPotokenEnabled(),
    loadToken: loadTokenFromCache,
    refreshToken: refreshTokenFromSidecar,
    buildInnertube: buildInnertubeWithToken,
  };
}

export async function withYoutubeSession<T>(
  op: (yt: Innertube) => Promise<T>,
  deps: SessionDeps = productionDeps(),
): Promise<T> {
  if (!deps.enabled) {
    return op(await deps.buildInnertube(null));
  }
  let tok = await deps.loadToken();
  if (!tok) tok = await deps.refreshToken();
  try {
    return await op(await deps.buildInnertube(tok));
  } catch (err) {
    if (!isYoutubeTokenExpiryError(err)) throw err;
    const fresh = await deps.refreshToken();
    return op(await deps.buildInnertube(fresh)); // second expiry propagates
  }
}

// Task 8 consumes this. Resolves a FRESH ephemeral audio-only stream URL at download
// time (URLs expire in hours / are IP-bound → never stored as media_url, §4).
// decipher() is async in youtubei.js@17 — must await to get the URL string, not a Promise.
export async function resolveYoutubeAudioUrl(videoId: string): Promise<string> {
  return withYoutubeSession(async (yt) => {
    const info = await yt.getInfo(videoId);
    let format: ReturnType<typeof info.chooseFormat>;
    try {
      format = info.chooseFormat({ type: 'audio', quality: 'best' });
    } catch {
      // chooseFormat THROWS (FormatError) rather than returning null when no audio format
      // matched — usually a stream withheld without a valid PoToken. Treat it as a token-expiry
      // smell so withYoutubeSession refreshes once and retries; a still-missing format after the
      // refresh then propagates → degrade (same outcome as an empty deciphered URL below).
      throw new YoutubeTokenExpiryError({ durationSeconds: null, title: null, cues: [] });
    }
    const url = await format.decipher(yt.session.player);
    if (!url) throw new YoutubeTokenExpiryError({ durationSeconds: null, title: null, cues: [] });
    return url;
  });
}
