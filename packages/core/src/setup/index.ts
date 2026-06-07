import { eq } from 'drizzle-orm';
import { embed, generateText } from 'ai';
import { getDbClient, sources, userSettings } from '../db';
import { env } from '../config/env';
import { hashPassword } from '../auth';
import { enqueueIngest, getBoss, registerQueues } from '../queue';
import {
  resolveEmbedding,
  resolveLLM,
  embeddingProviderOptions,
  type EmbeddingConfig,
  type LLMConfig,
} from '../ai';

export async function isInitialized(): Promise<boolean> {
  const db = getDbClient();
  const rows = await db
    .select({ id: userSettings.id })
    .from(userSettings)
    .where(eq(userSettings.id, 1))
    .limit(1);
  return rows.length > 0;
}

export interface SetupInput {
  password: string;
  locale: 'zh' | 'en';
  llm: { provider: string; baseUrl?: string; apiKey?: string; model: string; cheapModel?: string };
  embedding: {
    provider: string;
    baseUrl?: string;
    apiKey?: string;
    model: string;
    requestDimensions?: boolean;
  };
  interestTags: string[];
}

export async function completeSetup(input: SetupInput): Promise<void> {
  const db = getDbClient();
  const passwordHash = await hashPassword(input.password);
  await db
    .insert(userSettings)
    .values({
      id: 1,
      passwordHash,
      locale: input.locale,
      embedDim: env.EMBED_DIM, // frozen at install time (Hard Invariant)
      llmProvider: input.llm.provider,
      llmBaseUrl: input.llm.baseUrl ?? null,
      llmApiKey: input.llm.apiKey ?? null,
      llmModel: input.llm.model,
      llmCheapModel: input.llm.cheapModel ?? input.llm.model,
      embedProvider: input.embedding.provider,
      embedBaseUrl: input.embedding.baseUrl ?? null,
      embedApiKey: input.embedding.apiKey ?? null,
      embedModel: input.embedding.model,
      embedRequestDimensions: input.embedding.requestDimensions ?? false,
      interestTags: input.interestTags,
    })
    .onConflictDoNothing({ target: userSettings.id });
}

export async function addRssSource(name: string, url: string): Promise<string> {
  const db = getDbClient();
  const rows = await db
    .insert(sources)
    .values({ type: 'rss', name, config: { url } })
    .returning({ id: sources.id });
  const id = rows[0]?.id;
  if (!id) throw new Error('Failed to create source');
  return id;
}

export async function triggerSourceFetch(sourceId: string): Promise<void> {
  const boss = await getBoss();
  await registerQueues(boss, 3); // idempotent; ensures the ingest queue exists before send
  await enqueueIngest(boss, sourceId);
}

export async function testLLM(cfg: LLMConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await generateText({ model: resolveLLM(cfg), prompt: 'ping' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function testEmbedding(
  cfg: EmbeddingConfig,
): Promise<{ ok: boolean; dim?: number; error?: string }> {
  try {
    const { embedding } = await embed({
      model: resolveEmbedding(cfg),
      value: 'ping',
      providerOptions: embeddingProviderOptions(cfg),
    });
    return { ok: true, dim: embedding.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
