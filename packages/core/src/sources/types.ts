export interface RawItem {
  externalId: string | null; // feed guid / entry id; used for (source_id, external_id) dedup
  url: string;
  title: string;
  author: string | null;
  publishedAt: Date | null;
  content: string | null; // best full text the feed itself carried (content:encoded), else null
}

export type TranscriptStatus =
  | 'na'
  | 'pending'
  | 'present'
  | 'skipped_too_long'
  | 'skipped_serverless'
  | 'unavailable';

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
}

export interface ExtractResult {
  rawContent: string | null;
  contentType: 'article' | 'video' | 'discussion' | 'paper';
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
