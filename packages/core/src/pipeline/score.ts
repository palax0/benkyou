import { eq } from 'drizzle-orm';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getDbClient, items } from '../db';
import { resolveLLM } from '../ai';
import { buildLLMConfig, getUserSettings } from '../settings';
import { truncateChars } from '../util/text';

// M1: depth scoring is stubbed at a fixed midpoint. Real hype/news/tutorial/
// deep-dive scoring (B) lands in M3 (spec §15).
export const DEPTH_SCORE_STUB = 0.5;

export const scoreSchema = z.object({
  topic_tags: z.array(z.string()).max(8),
  topic_score: z.number().min(0).max(1),
  category: z.enum(['news', 'knowledge']),
});
export type ScoreResult = z.infer<typeof scoreSchema>;

export function buildScorePrompt(input: {
  title: string;
  content: string;
  interestTags: string[];
}): string {
  const interests = input.interestTags.length ? input.interestTags.join(', ') : '(none specified)';
  return [
    'You are scoring a piece of content for a personal AI-news reader.',
    `User interests: ${interests}`,
    '',
    `Title: ${input.title}`,
    'Content excerpt:',
    input.content || '(no body text available; judge from the title)',
    '',
    "Return topic_tags (normalized lowercase keywords), topic_score (0..1 relevance to the user's interests),",
    "and category: 'news' for hype/announcements, 'knowledge' for tutorials/deep-dives.",
  ].join('\n');
}

export async function scoreItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  const settings = await getUserSettings();
  if (!settings) throw new Error('user_settings not initialized');
  const cfg = buildLLMConfig(settings, { cheap: true });

  const prompt = buildScorePrompt({
    title: item.title,
    content: truncateChars(item.rawContent, 6000),
    interestTags: settings.interestTags ?? [],
  });

  const { object } = await generateObject({ model: resolveLLM(cfg), schema: scoreSchema, prompt });

  // numeric columns are strings in Drizzle's postgres-js driver.
  await db
    .update(items)
    .set({
      topicTags: object.topic_tags,
      topicScore: String(object.topic_score),
      depthScore: String(DEPTH_SCORE_STUB),
      category: object.category,
    })
    .where(eq(items.id, itemId));
}
