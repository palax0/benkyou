import Parser from 'rss-parser';
import type { RawItem, SourceAdapter } from './types';
import { extractArticle } from './extract-article';

interface RssConfig extends Record<string, unknown> {
  url: string;
}

interface FeedItem {
  guid?: string;
  link?: string;
  title?: string;
  creator?: string;
  author?: string;
  isoDate?: string;
  pubDate?: string;
  content?: string;
  contentEncoded?: string;
  enclosure?: { url?: string; type?: string };
  itunesDuration?: string;
}

function isRssConfig(c: Record<string, unknown>): c is RssConfig {
  return typeof c.url === 'string' && c.url.length > 0;
}

// hh:mm:ss | mm:ss | ss → seconds; null on garbage
export function parseItunesDuration(raw: string | undefined): number | null {
  if (!raw) return null;
  const parts = raw.trim().split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
  return Number.isFinite(secs) && secs > 0 ? Math.round(secs) : null;
}

export const rssAdapter: SourceAdapter = {
  type: 'rss',
  async fetchItems(config) {
    if (!isRssConfig(config)) {
      throw new Error('rss source requires config.url (string)');
    }
    const res = await fetch(config.url, {
      headers: { 'user-agent': 'benkyou/0.1 (+https://github.com/benkyou)' },
    });
    if (!res.ok) {
      throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
    }
    const xml = await res.text();

    // `content:encoded` is not a default rss-parser field; map it explicitly.
    // `itunes:duration` is likewise non-default; rss-parser surfaces `enclosure` natively.
    const parser: Parser<unknown, FeedItem> = new Parser({
      customFields: { item: [['content:encoded', 'contentEncoded'], ['itunes:duration', 'itunesDuration']] },
    });
    const feed = await parser.parseString(xml);

    return (feed.items ?? [])
      .map((it): RawItem => {
        const when = it.isoDate ?? it.pubDate ?? null;
        const enclosureUrl =
          it.enclosure?.type?.startsWith('audio/') || it.enclosure?.type?.startsWith('video/')
            ? (it.enclosure.url ?? null) : null;
        return {
          externalId: it.guid ?? it.link ?? null,
          url: it.link ?? '',
          title: it.title ?? '(untitled)',
          author: it.creator ?? it.author ?? null,
          publishedAt: when ? new Date(when) : null,
          content: it.contentEncoded ?? it.content ?? null,
          mediaUrl: enclosureUrl,
          contentType: enclosureUrl ? 'audio' : 'article',
          videoDuration: parseItunesDuration(it.itunesDuration),
        };
      })
      .filter((r) => r.url.length > 0);
  },
  extract: extractArticle,
};
