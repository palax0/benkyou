import { describe, expect, test } from 'vitest';
import { buildEmbeddingConfig, buildLLMConfig } from '../../src/settings/index.js';
import type { UserSettings } from '../../src/settings/index.js';

function settings(overrides: Partial<UserSettings>): UserSettings {
  return overrides as unknown as UserSettings;
}

describe('buildLLMConfig', () => {
  test('uses cheap model when requested, falls back to main model', () => {
    const s = settings({
      llmProvider: 'openai',
      llmModel: 'gpt-4.1',
      llmCheapModel: 'gpt-4.1-mini',
      llmBaseUrl: null,
      llmApiKey: 'k',
    });
    expect(buildLLMConfig(s, { cheap: true })).toEqual({
      provider: 'openai',
      baseUrl: undefined,
      apiKey: 'k',
      model: 'gpt-4.1-mini',
    });
    expect(buildLLMConfig(s).model).toBe('gpt-4.1');
    expect(buildLLMConfig(settings({ llmProvider: 'openai', llmModel: 'gpt-4.1', llmCheapModel: null }), { cheap: true }).model).toBe('gpt-4.1');
  });

  test('throws when provider/model missing', () => {
    expect(() => buildLLMConfig(settings({ llmProvider: null, llmModel: null }))).toThrow(/LLM not configured/);
  });
});

describe('buildEmbeddingConfig', () => {
  test('maps embed_* fields', () => {
    const s = settings({ embedProvider: 'openai', embedModel: 'text-embedding-3-small', embedBaseUrl: null, embedApiKey: 'k' });
    expect(buildEmbeddingConfig(s)).toEqual({
      provider: 'openai',
      baseUrl: undefined,
      apiKey: 'k',
      model: 'text-embedding-3-small',
    });
  });

  test('throws when embedding not configured', () => {
    expect(() => buildEmbeddingConfig(settings({ embedProvider: null, embedModel: null }))).toThrow(/Embedding not configured/);
  });

  test('derives dimensions from embedDim when embedRequestDimensions is true', () => {
    const s = settings({
      embedProvider: 'openai',
      embedModel: 'text-embedding-3-large',
      embedBaseUrl: null,
      embedApiKey: 'k',
      embedDim: 1536,
      embedRequestDimensions: true,
    });
    expect(buildEmbeddingConfig(s).dimensions).toBe(1536);
  });

  test('leaves dimensions undefined when embedRequestDimensions is false', () => {
    const s = settings({
      embedProvider: 'openai',
      embedModel: 'text-embedding-3-small',
      embedBaseUrl: null,
      embedApiKey: 'k',
      embedDim: 1536,
      embedRequestDimensions: false,
    });
    expect(buildEmbeddingConfig(s).dimensions).toBeUndefined();
  });
});
