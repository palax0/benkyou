import { streamText } from 'ai';
import { eq } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { resolveLLM } from '../ai/provider';
import { buildLLMConfig, getUserSettings } from '../settings';
import { getItemForUser } from './queries';

export function buildDeepSummaryPrompt(
  item: { title: string; rawContent: string | null },
  lang: string,
): string {
  return [
    `Write a structured deep summary in ${lang} of the article below.`,
    'Use exactly these sections: "TL;DR" (1-2 sentences), "Key points" (3-6 bullets),',
    'and "What you\'ll learn" (1-3 bullets). No preamble.',
    '',
    `Title: ${item.title}`,
    (item.rawContent ?? '').slice(0, 12000) || '(no body text available)',
  ].join('\n');
}

export async function saveDeepSummary(id: string, text: string): Promise<void> {
  const db = getDbClient();
  await db
    .update(items)
    .set({ deepSummary: text, deepSummaryAt: new Date() })
    .where(eq(items.id, id));
}

/**
 * Fetches or streams the deep summary for an item and returns a Response.
 * Keeps all `ai` SDK usage inside @benkyou/core so apps/web has no direct dep on `ai`.
 */
export async function streamDeepSummaryResponse(id: string): Promise<Response> {
  const item = await getItemForUser(id);
  if (!item) return new Response('Not found', { status: 404 });

  // Cached: return the stored summary as a plain text body.
  if (item.deepSummary) {
    return new Response(item.deepSummary, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const settings = await getUserSettings();
  if (!settings) return new Response('Not configured', { status: 500 });

  const lang = settings.locale === 'en' ? 'English' : 'Chinese';
  const result = streamText({
    model: resolveLLM(buildLLMConfig(settings)),
    prompt: buildDeepSummaryPrompt({ title: item.title, rawContent: item.rawContent }, lang),
    onFinish: async ({ text }: { text: string }) => {
      await saveDeepSummary(id, text); // persist once on completion (spec §6.2)
    },
  });
  return result.toTextStreamResponse();
}
