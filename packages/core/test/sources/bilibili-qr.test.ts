import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  mapQrPollCode,
  parseSessdataFromSetCookie,
  generateBilibiliQr,
  pollBilibiliQr,
} from '../../src/sources/bilibili-qr.js';

vi.mock('../../src/sources/platform-credentials.js', () => ({
  upsertPlatformCredential: vi.fn(async () => {}),
}));
import { upsertPlatformCredential } from '../../src/sources/platform-credentials.js';

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('mapQrPollCode', () => {
  test.each([
    [0, 'success'],
    [86101, 'pending'],
    [86090, 'scanned'],
    [86038, 'expired'],
    [99999, 'pending'],
  ] as const)('%i → %s', (code, status) => {
    expect(mapQrPollCode(code)).toBe(status);
  });
});

describe('parseSessdataFromSetCookie', () => {
  test('extracts SESSDATA value + Expires epoch', () => {
    const r = parseSessdataFromSetCookie([
      'SESSDATA=abc%2Cdef; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly',
      'bili_jct=xyz; Path=/',
    ]);
    expect(r.sessdata).toBe('abc%2Cdef');
    expect(r.expiresAt).toBe(Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'));
  });
  test('null when SESSDATA absent', () => {
    expect(parseSessdataFromSetCookie(['bili_jct=xyz'])).toEqual({ sessdata: null, expiresAt: null });
  });
  test('Max-Age takes precedence over Expires (RFC 6265 §5.3)', () => {
    const before = Date.now();
    const r = parseSessdataFromSetCookie([
      'SESSDATA=mx; Path=/; Max-Age=3600; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly',
    ]);
    expect(r.sessdata).toBe('mx');
    // Max-Age → now+1h, well below the far-future Expires epoch — proves Max-Age won.
    expect(r.expiresAt!).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(r.expiresAt!).toBeLessThanOrEqual(Date.now() + 3600 * 1000);
  });
});

describe('generateBilibiliQr', () => {
  test('returns qrcodeKey + url from the generate endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { url: 'https://qr', qrcode_key: 'KEY1' } }), { status: 200 }),
    );
    expect(await generateBilibiliQr()).toEqual({ qrcodeKey: 'KEY1', url: 'https://qr' });
  });
});

describe('pollBilibiliQr', () => {
  test('success: persists SESSDATA from Set-Cookie + expiry meta', async () => {
    const headers = new Headers();
    headers.append('set-cookie', 'SESSDATA=SD123; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { code: 0 } }), { status: 200, headers }),
    );
    const r = await pollBilibiliQr('KEY1');
    expect(r.status).toBe('success');
    expect(upsertPlatformCredential).toHaveBeenCalledWith('bilibili', {
      secret: 'SD123',
      meta: { expiresAt: Date.parse('Wed, 21 Oct 2026 07:28:00 GMT') },
    });
  });

  test('pending: does not persist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { code: 86101 } }), { status: 200 }),
    );
    expect((await pollBilibiliQr('KEY1')).status).toBe('pending');
    expect(upsertPlatformCredential).not.toHaveBeenCalled();
  });
});
