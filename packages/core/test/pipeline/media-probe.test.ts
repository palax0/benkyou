import { describe, expect, test, vi } from 'vitest';
import { assertHttpUrl, TRANSCRIBE_MAX_BYTES, downloadToTmp, isBlockedAddress, assertSafeHttpUrl } from '../../src/pipeline/media-probe.js';

// vi.mock must be at module top-level (hoisted). We mock dns/promises globally and control
// per-test behavior via mockResolvedValue / mockRestore.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

describe('media-probe guards', () => {
  test('accepts http and https', () => {
    expect(assertHttpUrl('http://x/a.mp3').protocol).toBe('http:');
    expect(assertHttpUrl('https://x/a.mp3').protocol).toBe('https:');
  });
  test('rejects file: and other schemes', () => {
    expect(() => assertHttpUrl('file:///etc/passwd')).toThrow();
    expect(() => assertHttpUrl('ftp://x/a.mp3')).toThrow();
    expect(() => assertHttpUrl('not a url')).toThrow();
  });
  test('byte ceiling is a generous multi-GB constant', () => {
    expect(TRANSCRIBE_MAX_BYTES).toBeGreaterThanOrEqual(1024 * 1024 * 1024);
  });
});

describe('isBlockedAddress', () => {
  describe('blocked addresses (expect true)', () => {
    test.each([
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
    ])('%s is blocked', (ip) => {
      expect(isBlockedAddress(ip)).toBe(true);
    });
  });

  describe('non-blocked addresses (expect false)', () => {
    test.each([
      '8.8.8.8',
      '1.1.1.1',
      '11.0.0.1',
      '172.15.0.1',
      '172.32.0.1',
      '100.63.255.255',
      '100.128.0.1',
      '2606:4700:4700::1111',
      '::ffff:8.8.8.8',
    ])('%s is not blocked', (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    });
  });
});

describe('assertSafeHttpUrl', () => {
  test('rejects IP-literal private address without DNS lookup', async () => {
    const dnsModule = await import('node:dns/promises');
    const lookupMock = vi.mocked(dnsModule.lookup);
    lookupMock.mockClear();
    await expect(assertSafeHttpUrl('http://169.254.169.254/latest')).rejects.toThrow(/private\/internal/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  test('rejects hostname that resolves to private IP via DNS', async () => {
    const dnsModule = await import('node:dns/promises');
    vi.mocked(dnsModule.lookup).mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);
    await expect(assertSafeHttpUrl('http://metadata.example/latest')).rejects.toThrow(/private\/internal/);
  });

  test('resolves to URL when hostname resolves to public IP via DNS', async () => {
    const dnsModule = await import('node:dns/promises');
    vi.mocked(dnsModule.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const result = await assertSafeHttpUrl('https://example.com/audio.mp3');
    expect(result).toBeInstanceOf(URL);
    expect(result.hostname).toBe('example.com');
  });
});

test('streaming download aborts when the body exceeds the ceiling despite a small Content-Length', async () => {
  // Mock DNS to return a public IP so the SSRF guard passes before reaching fetch
  const dnsModule = await import('node:dns/promises');
  vi.mocked(dnsModule.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);

  const huge = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(64 * 1024 * 1024)); }, // never ends
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(huge, { status: 200, headers: { 'content-length': '10' } }),
  );
  await expect(downloadToTmp('https://cdn/a.mp3', 1024)).rejects.toThrow(/byte ceiling/);
  vi.restoreAllMocks();
});

describe('downloadToTmp redirect SSRF guard', () => {
  test('redirect to an internal IP is blocked before a second fetch is made', async () => {
    // Original host resolves to a public IP — guard passes for the initial URL
    const dnsModule = await import('node:dns/promises');
    vi.mocked(dnsModule.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);

    // First fetch returns a 302 to the AWS metadata endpoint (IP literal → blocked immediately)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }),
    );

    await expect(downloadToTmp('https://feed.example/a.mp3')).rejects.toThrow(/private\/internal/);
    // The redirect target is an IP literal — assertSafeHttpUrl blocks it before issuing a second fetch
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  test('public-to-public redirect followed by a 200 resolves to {path, cleanup}', async () => {
    const dnsModule = await import('node:dns/promises');
    vi.mocked(dnsModule.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);

    // First call: 302 to a different public CDN host; second call: 200 with a small body
    const smallBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn2.example/a.mp3' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(smallBody, { status: 200, headers: { 'content-length': '8' } }),
      );

    const result = await downloadToTmp('https://cdn.example/a.mp3');
    expect(result).toHaveProperty('path');
    expect(result).toHaveProperty('cleanup');
    expect(typeof result.cleanup).toBe('function');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await result.cleanup();

    vi.restoreAllMocks();
  });
});
