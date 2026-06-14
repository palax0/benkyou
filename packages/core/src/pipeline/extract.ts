import { eq } from 'drizzle-orm';
import { getDbClient, items, sources } from '../db';
import { resolveAdapter } from '../sources';
import { getUserSettings } from '../settings';
import type { ExtractResult } from '../sources/types';

// Pure mapping from adapter result → items column patch. Dispatcher defaults
// contentMd=null and extractStatus='ok' (parallels transcriptStatus default).
export function extractColumns(result: ExtractResult, existing: { videoKind: string | null }) {
  return {
    rawContent: result.rawContent,
    contentMd: result.contentMd ?? null,
    extractStatus: result.extractStatus ?? 'ok',
    contentType: result.contentType,
    transcriptStatus: result.transcriptStatus ?? 'na',
    transcriptSegments: result.transcriptSegments ?? null,
    videoDuration: result.videoDuration ?? null,
    // M2a does not classify videoKind; preserve any existing value.
    videoKind: result.videoKind ?? existing.videoKind ?? null,
  };
}

export async function extractItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  let type: string | null = null;
  let config: Record<string, unknown> | undefined;
  if (item.sourceId) {
    const srcRows = await db
      .select({ type: sources.type, config: sources.config })
      .from(sources)
      .where(eq(sources.id, item.sourceId))
      .limit(1);
    type = srcRows[0]?.type ?? null;
    config = srcRows[0]?.config as Record<string, unknown> | undefined;
  }

  // Reader fallback is enabled only when reader_base_url is set (design §5).
  const settings = await getUserSettings();
  const reader = settings?.readerBaseUrl
    ? { baseUrl: settings.readerBaseUrl, apiKey: settings.readerApiKey ?? undefined }
    : undefined;

  const adapter = resolveAdapter({ type, url: item.url });
  const result = await adapter.extract({
    url: item.url,
    rawContent: item.rawContent,
    externalId: item.externalId,
    config,
    reader,
  });

  await db.update(items).set(extractColumns(result, { videoKind: item.videoKind })).where(eq(items.id, itemId));
}
