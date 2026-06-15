import { beforeEach, describe, expect, test, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  values: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('../../src/db/index.js', () => ({
  aiUsage: {},
  getDbClient: vi.fn(() => ({
    insert: dbMock.insert,
  })),
}));

describe('recordUsage', () => {
  beforeEach(() => {
    dbMock.values.mockReset();
    dbMock.values.mockResolvedValue(undefined);
    dbMock.insert.mockReset();
    dbMock.insert.mockReturnValue({ values: dbMock.values });
  });

  test('normalizes non-finite token counts to null', async () => {
    const { recordUsage } = await import('../../src/ai/usage.js');

    await recordUsage(
      { stage: 'search', itemId: null },
      { kind: 'embedding', model: 'gemini-embedding-2', inputTokens: NaN, outputTokens: null, totalTokens: NaN },
    );

    expect(dbMock.values).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      }),
    );
  });
});
