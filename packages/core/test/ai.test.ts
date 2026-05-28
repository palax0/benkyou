import { describe, expect, test } from 'vitest';
import { resolveLLM, resolveEmbedding } from '../src/ai/provider.js';

describe('AI provider factory', () => {
  test('resolves anthropic provider', () => {
    const m = resolveLLM({ provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-haiku-4-5' });
    expect(m).toBeDefined();
    expect(m.modelId).toContain('claude');
  });

  test('resolves openai-compatible provider with baseURL', () => {
    const m = resolveLLM({
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'unused',
      model: 'qwen2.5:7b',
    });
    expect(m).toBeDefined();
    expect(m.modelId).toBe('qwen2.5:7b');
  });

  test('throws on unknown provider', () => {
    expect(() =>
      resolveLLM({ provider: 'unknown', apiKey: '', model: 'x' }),
    ).toThrow(/unknown.*provider/i);
  });

  test('resolves openai embedding', () => {
    const m = resolveEmbedding({ provider: 'openai', apiKey: 'sk', model: 'text-embedding-3-small' });
    expect(m).toBeDefined();
  });

  test('throws on unknown embedding provider', () => {
    expect(() =>
      resolveEmbedding({ provider: 'unknown', apiKey: '', model: 'x' }),
    ).toThrow(/unknown.*provider/i);
  });

  test('throws when ollama embedding missing baseUrl', () => {
    expect(() =>
      resolveEmbedding({ provider: 'ollama', model: 'nomic-embed-text' }),
    ).toThrow(/requires baseUrl/);
  });
});
