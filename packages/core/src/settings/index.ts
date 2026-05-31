import { eq } from 'drizzle-orm';
import { getDbClient, userSettings } from '../db';
import type { EmbeddingConfig, LLMConfig } from '../ai';

export type UserSettings = typeof userSettings.$inferSelect;

export async function getUserSettings(): Promise<UserSettings | null> {
  const db = getDbClient();
  const rows = await db.select().from(userSettings).where(eq(userSettings.id, 1)).limit(1);
  return rows[0] ?? null;
}

export function buildLLMConfig(s: UserSettings, opts?: { cheap?: boolean }): LLMConfig {
  const model = opts?.cheap ? (s.llmCheapModel ?? s.llmModel) : s.llmModel;
  if (!s.llmProvider || !model) {
    throw new Error('LLM not configured (llm_provider / llm_model missing in user_settings)');
  }
  return {
    provider: s.llmProvider,
    baseUrl: s.llmBaseUrl ?? undefined,
    apiKey: s.llmApiKey ?? undefined,
    model,
  };
}

export function buildEmbeddingConfig(s: UserSettings): EmbeddingConfig {
  if (!s.embedProvider || !s.embedModel) {
    throw new Error('Embedding not configured (embed_provider / embed_model missing in user_settings)');
  }
  return {
    provider: s.embedProvider,
    baseUrl: s.embedBaseUrl ?? undefined,
    apiKey: s.embedApiKey ?? undefined,
    model: s.embedModel,
  };
}
