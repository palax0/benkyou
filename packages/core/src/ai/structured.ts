import { asSchema, generateText, Output } from 'ai';
import type { z } from 'zod';
import { resolveLLM, type LLMConfig } from './provider';
import { recordUsage, type UsageContext } from './usage';

const JSON_INSTRUCTION = 'Respond with a single JSON object.';

// The AI SDK does NOT normalize object generation across providers: for openai /
// openai-compatible / ollama JSON mode downgrades to response_format=json_object and
// injects no instruction. OpenAI-family endpoints reject json_object mode unless
// the literal word "json" appears in the prompt. We guarantee that floor here so
// no call site can reintroduce that runtime failure; harmless for anthropic/google.
// This is why all structured-output calls must go through generateStructured()
// rather than calling the SDK directly.
export function ensureJsonInstruction(prompt: string): string {
  return prompt.toLowerCase().includes('json') ? prompt : `${prompt}\n\n${JSON_INSTRUCTION}`;
}

export interface GenerateStructuredOptions<T> {
  cfg: LLMConfig;
  schema: z.ZodType<T>;
  prompt: string;
  ctx: UsageContext;
  schemaName?: string;
  schemaDescription?: string;
}

function usesOpenAICompatibleJsonObjectMode(cfg: LLMConfig): boolean {
  return cfg.provider === 'openai-compatible' || cfg.provider === 'ollama';
}

async function promptWithJsonSchema<T>(opts: GenerateStructuredOptions<T>): Promise<string> {
  const jsonSchema = await asSchema(opts.schema).jsonSchema;
  return [
    ensureJsonInstruction(opts.prompt),
    '',
    'JSON schema:',
    JSON.stringify(jsonSchema),
    opts.schemaDescription ? `Schema description: ${opts.schemaDescription}` : undefined,
    opts.schemaName ? `Schema name: ${opts.schemaName}` : undefined,
    'You MUST answer with a JSON object that matches the JSON schema above.',
  ]
    .filter((line) => line != null)
    .join('\n');
}

export async function generateStructured<T>(
  opts: GenerateStructuredOptions<T>,
): Promise<{ object: T }> {
  if (usesOpenAICompatibleJsonObjectMode(opts.cfg)) {
    // @ai-sdk/openai-compatible warns when a schema is passed while
    // supportsStructuredOutputs=false. Keep wire mode at json_object and validate
    // locally so generic endpoints such as DeepSeek/Ollama do not need json_schema.
    const result = await generateText({
      model: resolveLLM(opts.cfg),
      output: Output.json({
        name: opts.schemaName,
        description: opts.schemaDescription,
      }),
      prompt: await promptWithJsonSchema(opts),
    });
    const usage = {
      inputTokens: result.totalUsage?.inputTokens ?? null,
      outputTokens: result.totalUsage?.outputTokens ?? null,
      totalTokens: result.totalUsage?.totalTokens ?? null,
    };
    await recordUsage(opts.ctx, {
      kind: 'llm', model: opts.cfg.model,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
    });
    return { object: await opts.schema.parseAsync(result.output) };
  }

  const result = await generateText({
    model: resolveLLM(opts.cfg),
    output: Output.object({
      schema: opts.schema,
      name: opts.schemaName,
      description: opts.schemaDescription,
    }),
    prompt: ensureJsonInstruction(opts.prompt),
  });
  const usage = {
    inputTokens: result.totalUsage?.inputTokens ?? null,
    outputTokens: result.totalUsage?.outputTokens ?? null,
    totalTokens: result.totalUsage?.totalTokens ?? null,
  };
  await recordUsage(opts.ctx, {
    kind: 'llm', model: opts.cfg.model,
    inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
  });
  return { object: result.output };
}
