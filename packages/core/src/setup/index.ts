import { eq } from 'drizzle-orm';
import { embed, generateText } from 'ai';
import { getDbClient, sources, userSettings } from '../db';
import { env } from '../config/env';
import { hashPassword } from '../auth';
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
}

// Bootstrap split (spec §4.2): create the single user_settings row with password +
// locale + frozen embed_dim ONLY. Provider columns stay NULL (nullable in schema);
// they are filled later in-app via the settings flow (onboarding step ①).
export async function completeSetup(input: SetupInput): Promise<{ inserted: boolean }> {
  const db = getDbClient();
  const passwordHash = await hashPassword(input.password);
  const rows = await db
    .insert(userSettings)
    .values({
      id: 1,
      passwordHash,
      locale: input.locale,
      embedDim: env.EMBED_DIM, // frozen at install time (Hard Invariant)
      interestTags: [],
    })
    .onConflictDoNothing({ target: userSettings.id })
    .returning({ id: userSettings.id });
  return { inserted: rows.length > 0 };
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

export { triggerSourceFetch } from '../sources/manage';

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
