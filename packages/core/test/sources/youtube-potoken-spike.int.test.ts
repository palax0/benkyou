import { describe, expect, test } from 'vitest';
import { Innertube } from 'youtubei.js';
import { fetchAnonymousPoToken } from '../../src/sources/potoken-client.js';

// §7 SPIKE — the load-bearing assumption. Proves that an anonymous PoToken unblocks
// (a) caption fetch and (b) audio-stream download for the known-blocked video.
// Run: `docker compose up -d potoken-provider` then
//   RUN_NET_TESTS=1 POTOKEN_PROVIDER_URL=http://localhost:4416 \
//   pnpm --filter @benkyou/core test youtube-potoken-spike
// (publish 4416 locally for the spike only; production uses `expose` + service name).
const RUN = process.env.RUN_NET_TESTS === '1' && Boolean(process.env.POTOKEN_PROVIDER_URL);
const BLOCKED_ID = '7qO8-kx3gW8'; // §0: captions [zh-Hans, zh-Hant], blocked without PoToken

describe.skipIf(!RUN)('PoToken spike (§7 gate)', () => {
  test('anonymous PoToken unblocks captions AND audio stream', async () => {
    const providerUrl = process.env.POTOKEN_PROVIDER_URL!;
    const probe = await Innertube.create({ retrieve_player: false });
    const visitorData = probe.session.context.client.visitorData ?? '';
    expect(visitorData.length).toBeGreaterThan(0);

    const poToken = await fetchAnonymousPoToken(providerUrl, visitorData);
    expect(poToken.length).toBeGreaterThan(0);

    const yt = await Innertube.create({ retrieve_player: true, po_token: poToken, visitor_data: visitorData });
    const info = await yt.getInfo(BLOCKED_ID);
    expect(info.playability_status?.status).toBe('OK');

    // (a) captions
    const transcript = await info.getTranscript();
    const segments = transcript.transcript.content?.body?.initial_segments ?? [];
    expect(segments.length).toBeGreaterThan(0);

    // (b) audio stream — decipher + fetch the first bytes
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    const url = await format.decipher(yt.session.player);
    expect(url).toMatch(/^https:\/\//);
    const head = await fetch(url, { headers: { range: 'bytes=0-1023' } });
    expect([200, 206]).toContain(head.status);
  }, 120_000);
});
