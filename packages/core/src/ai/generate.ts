import { embed, embedMany, generateText, streamText } from 'ai';
import {
  resolveLLM, resolveEmbedding, embeddingProviderOptions,
  type LLMConfig, type EmbeddingConfig,
} from './provider';
import { recordUsage, type UsageContext } from './usage';

export async function generateTextRecorded(args: {
  cfg: LLMConfig; ctx: UsageContext; prompt: string;
}): Promise<{ text: string }> {
  const { text, usage } = await generateText({ model: resolveLLM(args.cfg), prompt: args.prompt });
  await recordUsage(args.ctx, {
    kind: 'llm', model: args.cfg.model,
    inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null,
  });
  return { text };
}

export function streamTextRecorded(args: {
  cfg: LLMConfig; ctx: UsageContext; prompt: string; onText?: (text: string) => Promise<void>;
}): ReturnType<typeof streamText> {
  return streamText({
    model: resolveLLM(args.cfg),
    prompt: args.prompt,
    onFinish: async ({ text, usage }) => {
      if (args.onText) await args.onText(text);
      await recordUsage(args.ctx, {
        kind: 'llm', model: args.cfg.model,
        inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null,
      });
    },
  });
}

export async function embedManyRecorded(args: {
  cfg: EmbeddingConfig; ctx: UsageContext; values: string[];
}): Promise<{ embeddings: number[][]; usage?: { tokens?: number } }> {
  const { embeddings, usage } = await embedMany({
    model: resolveEmbedding(args.cfg), values: args.values,
    providerOptions: embeddingProviderOptions(args.cfg),
  });
  await recordUsage(args.ctx, {
    kind: 'embedding', model: args.cfg.model,
    inputTokens: usage?.tokens ?? null, outputTokens: null, totalTokens: usage?.tokens ?? null,
  });
  return { embeddings, usage };
}

export async function embedRecorded(args: {
  cfg: EmbeddingConfig; ctx: UsageContext; value: string;
}): Promise<{ embedding: number[]; usage?: { tokens?: number } }> {
  const { embedding, usage } = await embed({
    model: resolveEmbedding(args.cfg), value: args.value,
    providerOptions: embeddingProviderOptions(args.cfg),
  });
  await recordUsage(args.ctx, {
    kind: 'embedding', model: args.cfg.model,
    inputTokens: usage?.tokens ?? null, outputTokens: null, totalTokens: usage?.tokens ?? null,
  });
  return { embedding, usage };
}
