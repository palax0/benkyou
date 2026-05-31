import { describe, expect, test } from 'vitest';
import { DEPTH_SCORE_STUB, buildScorePrompt, scoreSchema } from '../../src/pipeline/score.js';

describe('score stage pure logic', () => {
  test('depth score is the documented M1 stub value', () => {
    expect(DEPTH_SCORE_STUB).toBe(0.5);
  });

  test('prompt includes interests and title', () => {
    const p = buildScorePrompt({ title: 'New LLM released', content: 'body', interestTags: ['llm', 'agents'] });
    expect(p).toContain('New LLM released');
    expect(p).toContain('llm, agents');
  });

  test('schema accepts a valid object and rejects a bad category', () => {
    expect(scoreSchema.parse({ topic_tags: ['llm'], topic_score: 0.7, category: 'news' })).toEqual({
      topic_tags: ['llm'],
      topic_score: 0.7,
      category: 'news',
    });
    expect(() => scoreSchema.parse({ topic_tags: [], topic_score: 2, category: 'news' })).toThrow();
    expect(() => scoreSchema.parse({ topic_tags: [], topic_score: 0.5, category: 'other' })).toThrow();
  });
});
