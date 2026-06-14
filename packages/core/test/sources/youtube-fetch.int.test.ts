import { describe, expect, test } from 'vitest';
import { youtubeAdapter } from '../../src/sources/youtube.js';

// Hits live YouTube. Off by default (flaky/PoToken churn — that's why the
// degradation contract exists). Run locally with RUN_NET_TESTS=1 to sanity-check
// the youtubei.js wiring against a known long-subtitled video.
const RUN = process.env.RUN_NET_TESTS === '1';

describe.skipIf(!RUN)('youtube live fetch', () => {
  test('a known captioned video yields present + segments', async () => {
    const r = await youtubeAdapter.extract({
      url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', // Big Buck Bunny (captioned)
      rawContent: null,
      externalId: null,
    });
    expect(['present', 'unavailable']).toContain(r.transcriptStatus);
    if (r.transcriptStatus === 'present') {
      expect(r.transcriptSegments?.length ?? 0).toBeGreaterThan(0);
      expect(r.rawContent?.length ?? 0).toBeGreaterThan(0);
    }
  }, 60_000);
});
