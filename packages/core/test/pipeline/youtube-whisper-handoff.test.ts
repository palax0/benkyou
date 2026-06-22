import { describe, expect, test } from 'vitest';
import { isYoutubeWhisperHandoff } from '../../src/pipeline/extract.js';

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const base = { contentType: 'video', transcriptStatus: 'unavailable', url: YT, videoDuration: 600 };

describe('isYoutubeWhisperHandoff', () => {
  test('video + unavailable + youtube + potoken-on + duration → true', () => {
    expect(isYoutubeWhisperHandoff(base, true)).toBe(true);
  });
  test('potoken off → false', () => {
    expect(isYoutubeWhisperHandoff(base, false)).toBe(false);
  });
  test('null duration → false (the ffprobe-watch-URL footgun guard, §4.2)', () => {
    expect(isYoutubeWhisperHandoff({ ...base, videoDuration: null }, true)).toBe(false);
  });
  test('transcript present → false', () => {
    expect(isYoutubeWhisperHandoff({ ...base, transcriptStatus: 'present' }, true)).toBe(false);
  });
  test('non-youtube url → false (Bilibili excluded from Layer 2)', () => {
    expect(isYoutubeWhisperHandoff({ ...base, url: 'https://www.bilibili.com/video/BV1xx411c7mD' }, true)).toBe(false);
  });
  test('non-video content type → false', () => {
    expect(isYoutubeWhisperHandoff({ ...base, contentType: 'article' }, true)).toBe(false);
  });
});
