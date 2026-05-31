import { describe, expect, test } from 'vitest';
import { buildDeepSummaryPrompt } from '../../src/items/deep-summary.js';

describe('buildDeepSummaryPrompt', () => {
  test('includes language, title, body, and the section structure', () => {
    const p = buildDeepSummaryPrompt({ title: 'Transformers 101', rawContent: 'long body text' }, 'English');
    expect(p).toContain('English');
    expect(p).toContain('Transformers 101');
    expect(p).toContain('long body text');
    expect(p).toContain('TL;DR');
  });

  test('handles missing body', () => {
    const p = buildDeepSummaryPrompt({ title: 'T', rawContent: null }, 'Chinese');
    expect(p).toContain('Chinese');
    expect(p).toContain('(no body text available)');
  });
});
