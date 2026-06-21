export type ContentType = 'article' | 'video' | 'discussion' | 'paper' | 'audio';

export interface RawItem {
  externalId: string | null; // feed guid / entry id; used for (source_id, external_id) dedup
  url: string;
  title: string;
  author: string | null;
  publishedAt: Date | null;
  content: string | null; // best full text the feed itself carried (content:encoded), else null
  mediaUrl: string | null; // direct audio/video download source (podcast enclosure); null for plain articles
  contentType: ContentType; // ingest writes this instead of hard-coding 'article'
  videoDuration: number | null; // seconds; from itunes:duration when present
}

export type TranscriptStatus =
  | 'na'
  | 'pending'
  | 'present'
  | 'skipped_too_long'
  | 'skipped_serverless'
  | 'unavailable';

// Article extraction observability (design §4.1). 'ok' = no needed enhancement
// step failed (adequate feed OR a successful direct/reader fetch — a legit short
// article is still 'ok'). Failure values mean an enhancement attempt failed.
export type FetchFailReason = 'blocked' | 'fetch_failed' | 'empty_parse';
export type ExtractStatus = 'ok' | FetchFailReason;

// fetchReadable / fetchViaReader return this instead of swallowing failures as null —
// the observability core of design §5.2. 'blocked' = 403 / Cloudflare challenge;
// 'fetch_failed' = network / 5xx / threw; 'empty_parse' = 200 but Readability empty (SPA).
export type FetchOutcome =
  | { ok: true; markdown: string; title?: string | null }
  | { ok: false; reason: FetchFailReason };

// Timed transcript contract (design §6, video-article-design.md): subtitle/Whisper
// paths emit timed cues; speaker is optional (only when the platform/endpoint provides it).
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface ExtractInput {
  url: string;
  rawContent: string | null;
  externalId: string | null;
  // config from the owning source row when source_id is set; absent for adhoc paste.
  config?: Record<string, unknown>;
  // Reader fallback config, threaded from user_settings by the extract dispatcher.
  // Absent → reader stage disabled (design §5: enabled only when reader_base_url set).
  reader?: { baseUrl: string; apiKey?: string };
}

export interface ExtractResult {
  rawContent: string | null;
  // Real title discovered during extraction (Readability / video metadata). The
  // dispatcher persists it ONLY over a URL placeholder (paste) — never over a feed
  // title. Absent → keep the existing title. See extract.ts resolveTitle.
  title?: string | null;
  contentMd?: string | null; // markdown body for display; dispatcher writes null if absent
  extractStatus?: ExtractStatus; // dispatcher defaults to 'ok' (parallels transcriptStatus)
  contentType: ContentType;
  transcriptStatus?: TranscriptStatus; // video adapters set this; dispatcher defaults to 'na'
  transcriptSegments?: TranscriptSegment[] | null; // timed cues → items.transcript_segments
  videoDuration?: number | null;
  videoKind?: string | null; // M2a leaves default; M3 score branch classifies
}

export interface SourceAdapter {
  readonly type: string;
  // config is the `sources.config` jsonb for this source (type-specific).
  fetchItems(config: Record<string, unknown>): Promise<RawItem[]>;
  // Per-item extraction. Adhoc paste passes config undefined.
  extract(input: ExtractInput): Promise<ExtractResult>;
}

// Thrown by a subtitle fetcher ONLY for genuine transient failures (network / 5xx),
// so the dispatcher rethrows and pg-boss retries. A definitive miss ("no captions",
// "login required") is NOT transient — the fetcher returns null and the adapter
// degrades to transcript_status='unavailable' (design §2 degradation contract).
export class TransientFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientFetchError';
  }
}
