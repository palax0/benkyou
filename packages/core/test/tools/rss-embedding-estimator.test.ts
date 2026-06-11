import { describe, expect, test } from 'vitest';
import {
  estimateEmbeddingInputTokens,
  estimateRssEmbeddingCost,
  type EstimateRawItem,
} from '../../src/tools/rss-embedding-estimator.js';

describe('estimateEmbeddingInputTokens', () => {
  test('counts the doc input and separate title input', () => {
    const estimated = estimateEmbeddingInputTokens({
      title: 'Short title',
      rawContent: 'a'.repeat(400),
    });

    expect(estimated.docTokens).toBe(103);
    expect(estimated.titleTokens).toBe(3);
    expect(estimated.totalTokens).toBe(106);
  });

  test('uses a conservative CJK estimate', () => {
    const estimated = estimateEmbeddingInputTokens({
      title: '中文标题',
      rawContent: '这是一个中文正文',
    });

    expect(estimated.docTokens).toBe(12);
    expect(estimated.titleTokens).toBe(4);
    expect(estimated.totalTokens).toBe(16);
  });
});

describe('estimateRssEmbeddingCost', () => {
  const baseItem: EstimateRawItem = {
    externalId: '1',
    url: 'https://site.test/a',
    title: 'First',
    content: 'short',
  };

  test('fetches readable text for short feed content and reports item totals', async () => {
    const result = await estimateRssEmbeddingCost({
      items: [baseItem],
      fetchReadable: async () => 'Readable article body '.repeat(50),
    });

    expect(result.fetchedItems).toBe(1);
    expect(result.estimatedItems).toBe(1);
    expect(result.readableFetched).toBe(1);
    expect(result.readableFailed).toBe(0);
    expect(result.totalTokens).toBeGreaterThan(estimateEmbeddingInputTokens({ title: 'First', rawContent: 'short' }).totalTokens);
    expect(result.items[0]).toMatchObject({
      title: 'First',
      url: 'https://site.test/a',
      contentSource: 'readability',
    });
  });

  test('excludes existing urls and source external ids when provided', async () => {
    const result = await estimateRssEmbeddingCost({
      items: [
        baseItem,
        { ...baseItem, externalId: '2', url: 'https://site.test/b' },
        { ...baseItem, externalId: '3', url: 'https://site.test/c' },
      ],
      existing: {
        urlHashes: new Set(['https://site.test/b']),
        sourceExternalIds: new Set(['3']),
      },
      hashUrl: (url) => url,
      fetchReadable: async () => null,
    });

    expect(result.fetchedItems).toBe(3);
    expect(result.skippedExisting).toBe(2);
    expect(result.estimatedItems).toBe(1);
    expect(result.items.map((item) => item.url)).toEqual(['https://site.test/a']);
  });
});
