import { eq } from 'drizzle-orm';
import { generateText } from 'ai';
import { getDbClient, items } from '../db';
import { resolveLLM, recordUsage } from '../ai';
import { buildLLMConfig, getUserSettings } from '../settings';
import { truncateChars } from '../util/text';

export async function summarizeItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  const settings = await getUserSettings();
  if (!settings) throw new Error('user_settings not initialized');
  const cfg = buildLLMConfig(settings, { cheap: true });
  const lang = settings.locale === 'en' ? 'English' : 'Chinese'; // spec §12: LLM output follows locale

  const prompt = [
    `Summarize the following article in 1-2 sentences, in ${lang}. Be concrete; no preamble, no "this article".`,
    '',
    `Title: ${item.title}`,
    truncateChars(item.rawContent, 6000) || '(no body text; summarize from the title)',
  ].join('\n');

  const { text, usage } = await generateText({ model: resolveLLM(cfg), prompt });
  await recordUsage(
    { stage: 'summary', itemId },
    { kind: 'llm', model: cfg.model, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, totalTokens: usage?.totalTokens ?? null },
  );
  // Writing summary also refreshes the generated search_vec column automatically.
  await db.update(items).set({ summary: text.trim() }).where(eq(items.id, itemId));
}
