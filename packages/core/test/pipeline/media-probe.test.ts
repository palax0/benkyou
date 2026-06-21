import { describe, expect, test, vi } from 'vitest';
import { assertHttpUrl, TRANSCRIBE_MAX_BYTES, downloadToTmp } from '../../src/pipeline/media-probe.js';

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

test('streaming download aborts when the body exceeds the ceiling despite a small Content-Length', async () => {
  const huge = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(64 * 1024 * 1024)); }, // never ends
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(huge, { status: 200, headers: { 'content-length': '10' } }),
  );
  await expect(downloadToTmp('https://cdn/a.mp3', 1024)).rejects.toThrow(/byte ceiling/);
  vi.restoreAllMocks();
});
