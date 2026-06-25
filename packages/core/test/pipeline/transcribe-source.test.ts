import { describe, expect, test } from 'vitest';
import { isYoutubeTranscribeSource } from '../../src/pipeline/transcribe.js';

describe('isYoutubeTranscribeSource', () => {
  test('YouTube watch URL, no mediaUrl → returns the videoId (yt-dlp byte path)', () => {
    expect(isYoutubeTranscribeSource({ mediaUrl: null, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }))
      .toBe('dQw4w9WgXcQ');
  });
  test('mediaUrl present (podcast/direct) → null (use downloadToTmp verbatim)', () => {
    expect(isYoutubeTranscribeSource({ mediaUrl: 'https://cdn/a.mp3', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }))
      .toBeNull();
  });
  test('non-YouTube URL, no mediaUrl → null', () => {
    expect(isYoutubeTranscribeSource({ mediaUrl: null, url: 'https://example.com/a.mp3' })).toBeNull();
  });
});
