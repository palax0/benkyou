import { describe, expect, test } from 'vitest';
import { aiReadiness, isAiConfigured } from '../../src/settings/index';

const base = { llmProvider: null, llmModel: null, embedProvider: null, embedModel: null };

describe('aiReadiness', () => {
  test('all provider+model present → aiConfigured', () => {
    const s = { llmProvider: 'openai', llmModel: 'gpt', embedProvider: 'openai', embedModel: 'emb' };
    expect(aiReadiness(s)).toBe('aiConfigured');
    expect(isAiConfigured(s)).toBe(true);
  });

  test('any provider/model missing → bootstrapped', () => {
    expect(aiReadiness(base)).toBe('bootstrapped');
    expect(aiReadiness({ ...base, llmProvider: 'openai', llmModel: 'gpt' })).toBe('bootstrapped');
    expect(isAiConfigured({ ...base, embedProvider: 'openai', embedModel: 'emb' })).toBe(false);
  });
});
