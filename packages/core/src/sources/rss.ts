import Parser from 'rss-parser';
import type { RawItem, SourceAdapter } from './types';

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
}

function isRssConfig(c: Record<string, unknown>): c is RssConfig {
  return typeof c.url === 'string' && c.url.length > 0;
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
    const parser: Parser<unknown, FeedItem> = new Parser({
      customFields: { item: [['content:encoded', 'contentEncoded']] },
    });
    const feed = await parser.parseString(xml);

    return (feed.items ?? [])
      .map((it): RawItem => {
        const when = it.isoDate ?? it.pubDate ?? null;
        return {
          externalId: it.guid ?? it.link ?? null,
          url: it.link ?? '',
          title: it.title ?? '(untitled)',
          author: it.creator ?? it.author ?? null,
          publishedAt: when ? new Date(when) : null,
          content: it.contentEncoded ?? it.content ?? null,
        };
      })
      .filter((r) => r.url.length > 0);
  },
};
