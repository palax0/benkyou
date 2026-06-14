import { and, eq, inArray } from 'drizzle-orm';
import { getDbClient, items, sources } from '../db';
import { fetchReadable } from '../sources/extract-article';
import { buildEmbeddingInputs } from '../pipeline/embedding-input';
import { rssAdapter } from '../sources/rss';
import { urlHash } from '../util/url';

const FULLTEXT_MIN_CHARS = 600;
const TOP_ITEMS_LIMIT = 10;

export interface EstimateRawItem {
  externalId: string | null;
  url: string;
  title: string;
  content: string | null;
}

export interface ExistingRssItemKeys {
  urlHashes: Set<string>;
  sourceExternalIds: Set<string>;
}

export interface EstimatedEmbeddingInput {
  docTokens: number;
  titleTokens: number;
  totalTokens: number;
  bodyChars: number;
}

export interface EstimatedRssItem extends EstimatedEmbeddingInput {
  title: string;
  url: string;
  externalId: string | null;
  contentSource: 'feed' | 'readability' | 'none';
}

export interface RssEmbeddingEstimate {
  fetchedItems: number;
  skippedExisting: number;
  estimatedItems: number;
  readableFetched: number;
  readableFailed: number;
  totalTokens: number;
  averageTokens: number;
  maxTokens: number;
  items: EstimatedRssItem[];
  topItems: EstimatedRssItem[];
}

export interface EstimateRssEmbeddingCostOptions {
  items: EstimateRawItem[];
  existing?: ExistingRssItemKeys;
  fetchReadable?: (url: string) => Promise<string | null>;
  hashUrl?: (url: string) => string;
}

export interface EstimateRssUrlOptions {
  url: string;
  useDb?: boolean;
  sourceId?: string;
}

function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0;

  let cjk = 0;
  let nonSpaceNonCjk = 0;
  for (const char of text) {
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(char)) {
      cjk++;
    } else if (!/\s/u.test(char)) {
      nonSpaceNonCjk++;
    }
  }

  return cjk + Math.ceil(nonSpaceNonCjk / 4);
}

export function estimateEmbeddingInputTokens(input: {
  title: string;
  rawContent: string | null | undefined;
}): EstimatedEmbeddingInput {
  const { titleText, bodyText } = buildEmbeddingInputs(input);
  const titleTokens = estimateTextTokens(titleText);
  const bodyTokens = estimateTextTokens(bodyText);

  return {
    docTokens: titleTokens + bodyTokens,
    titleTokens,
    totalTokens: titleTokens + bodyTokens + titleTokens,
    bodyChars: bodyText.length,
  };
}

function shouldSkipItem(item: EstimateRawItem, existing: ExistingRssItemKeys | undefined, hashUrl: (url: string) => string): boolean {
  if (!existing) return false;
  if (existing.urlHashes.has(hashUrl(item.url))) return true;
  return item.externalId !== null && existing.sourceExternalIds.has(item.externalId);
}

// Adapt the FetchOutcome-returning fetchReadable to the string|null shape expected
// by this estimator tool. Estimator only needs the text; failure reason is irrelevant here.
async function fetchReadableAsText(url: string): Promise<string | null> {
  const outcome = await fetchReadable(url);
  return outcome.ok ? outcome.markdown : null;
}

export async function estimateRssEmbeddingCost(options: EstimateRssEmbeddingCostOptions): Promise<RssEmbeddingEstimate> {
  const hashUrl = options.hashUrl ?? urlHash;
  const fetcher = options.fetchReadable ?? fetchReadableAsText;
  const candidateItems = options.items.filter((item) => !shouldSkipItem(item, options.existing, hashUrl));

  let readableFetched = 0;
  let readableFailed = 0;
  const estimated: EstimatedRssItem[] = [];

  for (const item of candidateItems) {
    let rawContent = item.content ?? '';
    let contentSource: EstimatedRssItem['contentSource'] = rawContent.length > 0 ? 'feed' : 'none';

    if (rawContent.length < FULLTEXT_MIN_CHARS) {
      const readable = await fetcher(item.url);
      if (readable && readable.length > rawContent.length) {
        rawContent = readable;
        contentSource = 'readability';
        readableFetched++;
      } else {
        readableFailed++;
      }
    }

    estimated.push({
      title: item.title,
      url: item.url,
      externalId: item.externalId,
      contentSource,
      ...estimateEmbeddingInputTokens({ title: item.title, rawContent }),
    });
  }

  const totalTokens = estimated.reduce((sum, item) => sum + item.totalTokens, 0);
  const topItems = [...estimated].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, TOP_ITEMS_LIMIT);

  return {
    fetchedItems: options.items.length,
    skippedExisting: options.items.length - candidateItems.length,
    estimatedItems: estimated.length,
    readableFetched,
    readableFailed,
    totalTokens,
    averageTokens: estimated.length === 0 ? 0 : Math.round(totalTokens / estimated.length),
    maxTokens: topItems[0]?.totalTokens ?? 0,
    items: estimated,
    topItems,
  };
}

export async function fetchRssItemsForEstimate(url: string): Promise<EstimateRawItem[]> {
  return rssAdapter.fetchItems({ url });
}

function isRssSourceConfig(config: unknown, url: string): boolean {
  return typeof config === 'object' && config !== null && 'url' in config && (config as { url?: unknown }).url === url;
}

export async function resolveSourceIdForRssUrl(url: string): Promise<string | null> {
  const db = getDbClient();
  const rows = await db
    .select({ id: sources.id, config: sources.config })
    .from(sources)
    .where(eq(sources.type, 'rss'));

  return rows.find((row) => isRssSourceConfig(row.config, url))?.id ?? null;
}

export async function loadExistingRssItemKeys(rawItems: EstimateRawItem[], sourceId?: string | null): Promise<ExistingRssItemKeys> {
  if (rawItems.length === 0) {
    return { urlHashes: new Set(), sourceExternalIds: new Set() };
  }

  const db = getDbClient();
  const hashes = rawItems.map((item) => urlHash(item.url));
  const urlRows = await db.select({ urlHash: items.urlHash }).from(items).where(inArray(items.urlHash, hashes));
  const urlHashes = new Set(urlRows.map((row) => row.urlHash));
  const sourceExternalIds = new Set<string>();

  if (sourceId) {
    const externalIds = rawItems
      .map((item) => item.externalId)
      .filter((externalId): externalId is string => externalId !== null);

    if (externalIds.length > 0) {
      const externalRows = await db
        .select({ externalId: items.externalId })
        .from(items)
        .where(and(eq(items.sourceId, sourceId), inArray(items.externalId, externalIds)));

      for (const row of externalRows) {
        if (row.externalId) sourceExternalIds.add(row.externalId);
      }
    }
  }

  return { urlHashes, sourceExternalIds };
}

export async function estimateRssUrlEmbeddingCost(options: EstimateRssUrlOptions): Promise<{
  sourceId: string | null;
  estimate: RssEmbeddingEstimate;
}> {
  const rawItems = await fetchRssItemsForEstimate(options.url);
  const sourceId = options.useDb ? options.sourceId ?? (await resolveSourceIdForRssUrl(options.url)) : null;
  const existing = options.useDb ? await loadExistingRssItemKeys(rawItems, sourceId) : undefined;
  const estimate = await estimateRssEmbeddingCost({ items: rawItems, existing });
  return { sourceId, estimate };
}
