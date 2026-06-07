import { describe, expect, test, vi, beforeEach } from 'vitest';

// Capture the `embed` call args. vi.hoisted lets the mock factory reference the spy.
const { embedSpy } = vi.hoisted(() => ({ embedSpy: vi.fn() }));
vi.mock('ai', () => ({
  embed: embedSpy,
  generateText: vi.fn(async () => ({ text: 'ok' })),
}));

describe('testEmbedding honors the dimensions toggle', () => {
  beforeEach(() => {
    embedSpy.mockReset();
    embedSpy.mockResolvedValue({ embedding: Array.from({ length: 1536 }, () => 0.01) });
  });

  test('passes providerOptions when cfg.dimensions is set', async () => {
    const { testEmbedding } = await import('../../src/setup/index.js');
    const res = await testEmbedding({ provider: 'openai', apiKey: 'k', model: 'm', dimensions: 1536 });
    expect(res.ok).toBe(true);
    expect(res.dim).toBe(1536);
    expect(embedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ providerOptions: { openai: { dimensions: 1536 } } }),
    );
  });

  test('omits providerOptions (undefined) when cfg.dimensions is unset', async () => {
    const { testEmbedding } = await import('../../src/setup/index.js');
    await testEmbedding({ provider: 'openai', apiKey: 'k', model: 'm' });
    expect(embedSpy).toHaveBeenCalledWith(expect.objectContaining({ providerOptions: undefined }));
  });
});
