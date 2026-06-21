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

const MEDIA_EXT: Record<string, 'audio' | 'video'> = {
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', flac: 'audio', aac: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
};
// Direct-media paste: URL whose extension is a known media type. Content-Type confirmation
// happens later via remote ffprobe (no sync probe in the web tier).
export function detectAdhocMedia(url: string): { contentType: 'audio' | 'video' } | null {
  let pathname = '';
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { return null; }
  const ext = pathname.split('.').pop() ?? '';
  const kind = MEDIA_EXT[ext];
  return kind ? { contentType: kind } : null;
}

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
