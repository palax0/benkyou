import { describe, expect, test } from 'vitest';
import { ensureJsonInstruction } from '../../src/ai/structured.js';

describe('ensureJsonInstruction', () => {
  // Guards the cross-provider invariant: generateObject downgrades to
  // response_format=json_object for openai-family providers, which reject the
  // request unless the prompt contains the literal word "json".
  test('appends a json instruction when the prompt lacks the word', () => {
    const out = ensureJsonInstruction('Score this content.');
    expect(out.toLowerCase()).toContain('json');
    expect(out.startsWith('Score this content.')).toBe(true);
  });

  test('leaves a prompt that already mentions json untouched', () => {
    const p = 'Return a JSON object with the score.';
    expect(ensureJsonInstruction(p)).toBe(p);
  });

  test('matches json case-insensitively', () => {
    const p = 'Reply as JSON only.';
    expect(ensureJsonInstruction(p)).toBe(p);
  });
});
