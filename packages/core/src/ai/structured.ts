import { generateObject } from 'ai';
import type { z } from 'zod';
import { resolveLLM, type LLMConfig } from './provider';

const JSON_INSTRUCTION = 'Respond with a single JSON object.';

// The AI SDK does NOT normalize object generation across providers: for openai /
// openai-compatible / ollama it downgrades to response_format=json_object and
// injects no instruction. OpenAI-family endpoints reject json_object mode unless
// the literal word "json" appears in the prompt. We guarantee that floor here so
// no call site can reintroduce that runtime failure; harmless for anthropic/google.
// This is why all structured-output calls must go through generateStructured()
// rather than importing generateObject directly.
export function ensureJsonInstruction(prompt: string): string {
  return prompt.toLowerCase().includes('json') ? prompt : `${prompt}\n\n${JSON_INSTRUCTION}`;
}

export interface GenerateStructuredOptions<T> {
  cfg: LLMConfig;
  schema: z.ZodType<T>;
  prompt: string;
  schemaName?: string;
  schemaDescription?: string;
}

export interface StructuredUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export async function generateStructured<T>(
  opts: GenerateStructuredOptions<T>,
): Promise<{ object: T; usage: StructuredUsage }> {
  const { object, usage } = await generateObject({
    model: resolveLLM(opts.cfg),
    schema: opts.schema,
    prompt: ensureJsonInstruction(opts.prompt),
    schemaName: opts.schemaName,
    schemaDescription: opts.schemaDescription,
  });
  return {
    object,
    usage: {
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
    },
  };
}
