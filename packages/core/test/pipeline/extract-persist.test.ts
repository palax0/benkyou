import { describe, expect, test } from 'vitest';
import type { ExtractResult } from '../../src/sources/types.js';
import { extractColumns } from '../../src/pipeline/extract.js';

describe('extractColumns (result → db column mapping)', () => {
  const base: ExtractResult = { rawContent: 'x', contentType: 'article' };

  test('defaults contentMd null and extractStatus ok when adapter omits them', () => {
    const cols = extractColumns(base, { videoKind: null });
    expect(cols.contentMd).toBeNull();
    expect(cols.extractStatus).toBe('ok');
  });

  test('passes through adapter-provided contentMd and extractStatus', () => {
    const cols = extractColumns(
      { ...base, contentMd: '# md', extractStatus: 'blocked' },
      { videoKind: null },
    );
    expect(cols.contentMd).toBe('# md');
    expect(cols.extractStatus).toBe('blocked');
  });
});
