import { describe, expect, test, vi } from 'vitest';
import { resolveDownloadSource } from '../../src/pipeline/transcribe.js';

describe('resolveDownloadSource', () => {
  test('mediaUrl present → use it verbatim (podcast/direct paste), no YouTube resolve', async () => {
    const resolver = vi.fn();
    const r = await resolveDownloadSource({ mediaUrl: 'https://cdn/a.mp3', url: 'https://cdn/a.mp3' }, resolver);
    expect(r).toBe('https://cdn/a.mp3');
    expect(resolver).not.toHaveBeenCalled();
  });

  test('YouTube watch url, no mediaUrl → resolve a fresh audio stream', async () => {
    const resolver = vi.fn(async () => 'https://rr3---googlevideo.com/videoplayback?x=1');
    const r = await resolveDownloadSource(
      { mediaUrl: null, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, resolver,
    );
    expect(resolver).toHaveBeenCalledWith('dQw4w9WgXcQ');
    expect(r).toMatch(/googlevideo\.com/);
  });

  test('non-YouTube url, no mediaUrl → use url verbatim', async () => {
    const resolver = vi.fn();
    const r = await resolveDownloadSource({ mediaUrl: null, url: 'https://example.com/a.mp3' }, resolver);
    expect(r).toBe('https://example.com/a.mp3');
    expect(resolver).not.toHaveBeenCalled();
  });
});
