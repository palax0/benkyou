import { generateText } from 'ai';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { ensureJsonInstruction, generateStructured } from '../../src/ai/structured.js';

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(),
    Output: actual.Output,
  };
});

// recordUsage writes to DB; stub it so these unit tests stay DB-free.
vi.mock('../../src/ai/usage.js', () => ({
  recordUsage: vi.fn(async () => undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function mockGenerateTextResult<T>(outputValue: T): Awaited<ReturnType<typeof generateText>> {
  return {
    output: outputValue,
    totalUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  } as unknown as Awaited<ReturnType<typeof generateText>>;
}

function firstGenerateTextOutput() {
  const outputSpec = vi.mocked(generateText).mock.calls[0]?.[0]?.output;
  if (!outputSpec) throw new Error('generateText was not called with output');
  return outputSpec;
}

describe('ensureJsonInstruction', () => {
  // Guards the cross-provider invariant: JSON output mode downgrades to
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

describe('generateStructured', () => {
  test('uses schema-free JSON output mode for openai-compatible providers', async () => {
    vi.mocked(generateText).mockResolvedValueOnce(mockGenerateTextResult({ ok: true }));

    const schema = z.object({ ok: z.boolean() });
    await expect(
      generateStructured({
        cfg: {
          provider: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          model: 'deepseek-v4-flash',
        },
        schema,
        prompt: 'Return JSON.',
        ctx: { stage: 'test', itemId: null },
      }),
    ).resolves.toEqual({
      object: { ok: true },
    });

    const outputSpec = firstGenerateTextOutput();
    expect(outputSpec.name).toBe('json');
    await expect(outputSpec.responseFormat).resolves.toEqual({ type: 'json' });
  });

  test('uses typed object output mode for providers with structured output support', async () => {
    vi.mocked(generateText).mockResolvedValueOnce(mockGenerateTextResult({ ok: true }));

    await generateStructured({
      cfg: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-test' },
      schema: z.object({ ok: z.boolean() }),
      prompt: 'Return JSON.',
      ctx: { stage: 'test', itemId: null },
      schemaName: 'response',
      schemaDescription: 'A test response.',
    });

    const outputSpec = firstGenerateTextOutput();
    expect(outputSpec.name).toBe('object');
    await expect(outputSpec.responseFormat).resolves.toEqual(
      expect.objectContaining({
        type: 'json',
        name: 'response',
        description: 'A test response.',
        schema: expect.objectContaining({ type: 'object' }),
      }),
    );
  });
});
