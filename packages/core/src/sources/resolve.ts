import type { SourceAdapter } from './types';
import { extractArticle } from './extract-article';
import { getAdapter, registerAdapter } from './registry';
import { rssAdapter } from './rss';
import { youtubeAdapter } from './youtube';
import { bilibiliAdapter } from './bilibili';

// 'article' is the adhoc default for non-video hosts. It is never polled (no auto
// source has type 'article'), so fetchItems throws to make a misuse loud.
export const articleAdapter: SourceAdapter = {
  type: 'article',
  async fetchItems(): Promise<never> {
    throw new Error('article adapter is adhoc-only; it has no feed to fetch');
  },
  extract: extractArticle,
};

// Register all adapters at module load time. This makes resolve.ts self-contained:
// any importer of resolveAdapter or detectAdhocType automatically gets a populated
// registry, whether they came through sources/index.ts or directly.
registerAdapter(rssAdapter);
registerAdapter(articleAdapter);
registerAdapter(youtubeAdapter);
registerAdapter(bilibiliAdapter);

// Adhoc paste: an item with no source_id. We have no source.type, so detect by host.
export function detectAdhocType(url: string): 'youtube' | 'bilibili' | 'article' {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'article';
  }
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
    return 'youtube';
  }
  if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) return 'bilibili';
  return 'article';
}

export function resolveAdapter(item: { type: string | null; url: string }): SourceAdapter {
  const type = item.type ?? detectAdhocType(item.url);
  return getAdapter(type);
}
