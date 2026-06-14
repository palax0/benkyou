import { describe, expect, test } from 'vitest';
import { TransientFetchError } from '../../src/sources/types.js';
import type { ExtractResult, TranscriptSegment } from '../../src/sources/types.js';

describe('sources/types', () => {
  test('TransientFetchError is an Error with a name', () => {
    const e = new TransientFetchError('5xx from upstream');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('TransientFetchError');
    expect(e.message).toContain('5xx');
  });

  test('ExtractResult shape compiles with timed segments', () => {
    const seg: TranscriptSegment = { start: 0, end: 1.5, text: 'hi' };
    const r: ExtractResult = {
      rawContent: 'hi',
      contentType: 'video',
      transcriptStatus: 'present',
      transcriptSegments: [seg],
      videoDuration: 90,
    };
    expect(r.transcriptSegments?.[0]?.speaker).toBeUndefined();
  });
});
