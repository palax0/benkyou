import { describe, expect, test } from 'vitest';
import { buildEmbeddingInputs, EMBED_CONTENT_MAX_CHARS } from '../../src/pipeline/embedding-input.js';

describe('buildEmbeddingInputs', () => {
  test('builds doc and title inputs for embedMany', () => {
    expect(buildEmbeddingInputs({ title: 'A title', rawContent: 'Body text' })).toEqual({
      docText: 'A title\n\nBody text',
      titleText: 'A title',
      bodyText: 'Body text',
    });
  });

  test('uses title only when body is empty', () => {
    expect(buildEmbeddingInputs({ title: 'Only title', rawContent: null })).toEqual({
      docText: 'Only title',
      titleText: 'Only title',
      bodyText: '',
    });
  });

  test('truncates body to the pipeline content limit', () => {
    const rawContent = 'x'.repeat(EMBED_CONTENT_MAX_CHARS + 5);

    const inputs = buildEmbeddingInputs({ title: 'T', rawContent });

    expect(inputs.bodyText).toHaveLength(EMBED_CONTENT_MAX_CHARS);
    expect(inputs.docText).toHaveLength('T\n\n'.length + EMBED_CONTENT_MAX_CHARS);
  });
});
