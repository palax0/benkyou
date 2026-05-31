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

export interface SettingsPatch {
  locale?: 'zh' | 'en';
  llmProvider?: string;
  llmBaseUrl?: string | null;
  llmApiKey?: string | null;
  llmModel?: string;
  llmCheapModel?: string | null;
  embedProvider?: string;
  embedBaseUrl?: string | null;
  embedApiKey?: string | null;
  embedModel?: string;
  interestTags?: string[];
}

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  const db = getDbClient();
  await db
    .update(userSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(userSettings.id, 1));
}

// Hashing stays in @benkyou/core/auth; the web action hashes then calls this.
export async function setPasswordHash(passwordHash: string): Promise<void> {
  const db = getDbClient();
  await db
    .update(userSettings)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(userSettings.id, 1));
}
