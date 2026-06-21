import { describe, expect, test, vi } from 'vitest';
import { rssAdapter } from '../../src/sources/rss.js';

const FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
  <item>
    <title>Ep 1</title><link>https://pod.example/ep1</link><guid>ep1</guid>
    <enclosure url="https://cdn.example/ep1.mp3" type="audio/mpeg" length="12345"/>
    <itunes:duration>1:02:03</itunes:duration>
  </item>
</channel></rss>`;

describe('rss enclosure → audio RawItem', () => {
  test('parses enclosure url + itunes:duration as audio item', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(FEED, { status: 200 }));
    const items = await rssAdapter.fetchItems({ url: 'https://pod.example/feed' });
    expect(items[0]).toMatchObject({
      url: 'https://pod.example/ep1',
      mediaUrl: 'https://cdn.example/ep1.mp3',
      contentType: 'audio',
      videoDuration: 3723, // 1*3600 + 2*60 + 3
    });
    vi.restoreAllMocks();
  });

  test('item without enclosure stays an article with null media', async () => {
    const noEncl = FEED.replace(/<enclosure[^>]*\/>/, '').replace(/<itunes:duration>.*<\/itunes:duration>/, '');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(noEncl, { status: 200 }));
    const items = await rssAdapter.fetchItems({ url: 'https://pod.example/feed' });
    expect(items[0]).toMatchObject({ contentType: 'article', mediaUrl: null, videoDuration: null });
    vi.restoreAllMocks();
  });
});
