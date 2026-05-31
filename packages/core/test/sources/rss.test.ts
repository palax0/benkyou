import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { rssAdapter } from '../../src/sources/rss.js';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Hello World</title>
      <link>https://example.com/posts/hello</link>
      <guid>post-1</guid>
      <pubDate>Wed, 28 May 2026 10:00:00 GMT</pubDate>
      <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Jane</dc:creator>
      <content:encoded><![CDATA[<p>This is the full article body.</p>]]></content:encoded>
    </item>
    <item>
      <title>No Body</title>
      <link>https://example.com/posts/nobody</link>
      <guid>post-2</guid>
    </item>
  </channel>
</rss>`;

const server = setupServer(
  http.get('https://feeds.test/rss', () =>
    new HttpResponse(FEED, { headers: { 'content-type': 'application/rss+xml' } }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('rssAdapter', () => {
  test('parses items, mapping guid/link/date/creator/content', async () => {
    const items = await rssAdapter.fetchItems({ url: 'https://feeds.test/rss' });
    expect(items).toHaveLength(2);

    const first = items[0]!;
    expect(first.title).toBe('Hello World');
    expect(first.url).toBe('https://example.com/posts/hello');
    expect(first.externalId).toBe('post-1');
    expect(first.author).toBe('Jane');
    expect(first.publishedAt?.toISOString()).toBe('2026-05-28T10:00:00.000Z');
    expect(first.content).toContain('full article body');

    const second = items[1]!;
    expect(second.content).toBeNull(); // no content:encoded -> extract stage will fetch+Readability
  });

  test('rejects config without url', async () => {
    await expect(rssAdapter.fetchItems({})).rejects.toThrow(/config\.url/);
  });

  test('throws on non-2xx', async () => {
    server.use(http.get('https://feeds.test/rss', () => new HttpResponse(null, { status: 503 })));
    await expect(rssAdapter.fetchItems({ url: 'https://feeds.test/rss' })).rejects.toThrow(
      /RSS fetch failed: 503/,
    );
  });
});
