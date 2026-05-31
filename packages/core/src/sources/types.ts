export interface RawItem {
  externalId: string | null; // feed guid / entry id; used for (source_id, external_id) dedup
  url: string;
  title: string;
  author: string | null;
  publishedAt: Date | null;
  content: string | null; // best full text the feed itself carried (content:encoded), else null
}

export interface SourceAdapter {
  readonly type: string;
  // config is the `sources.config` jsonb for this source (type-specific).
  fetchItems(config: Record<string, unknown>): Promise<RawItem[]>;
}
