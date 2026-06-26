import { eq } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { urlHash } from '../util/url';
import { detectAdhocType, detectAdhocMedia } from '../sources';
import { getBoss, registerQueues, enqueueStage } from '../queue';
import type { ItemState, PerItemStage } from '../pipeline/state';
import type { TranscriptStatus } from '../sources/types';

export type PasteResult =
  | { created: string }
  | {
      existing: {
        id: string;
        state: ItemState;
        currentStage: PerItemStage | null;
        transcriptStatus: TranscriptStatus;
        title: string;
      };
    };

// Initial content_type so the feed/progress UI shows the right kind before extract
// runs. extract overwrites it from the adapter's ExtractResult.
function initialContentType(url: string): 'article' | 'video' {
  return detectAdhocType(url) === 'article' ? 'article' : 'video';
}

// Shared by both dedup-hit paths (existing-hash and lost-insert-race) so they
// return the identical shape (spec §4 / §7).
async function existingResult(db: ReturnType<typeof getDbClient>, hash: string): Promise<PasteResult> {
  const rows = await db
    .select({
      id: items.id,
      state: items.state,
      currentStage: items.currentStage,
      transcriptStatus: items.transcriptStatus,
      title: items.title,
    })
    .from(items)
    .where(eq(items.urlHash, hash))
    .limit(1);
  const e = rows[0]!;
  return {
    existing: {
      id: e.id,
      state: e.state as ItemState,
      currentStage: e.currentStage as PerItemStage | null,
      transcriptStatus: e.transcriptStatus as TranscriptStatus,
      title: e.title,
    },
  };
}

export async function pasteUrl(rawUrl: string): Promise<PasteResult> {
  const db = getDbClient();
  const hash = urlHash(rawUrl);

  const existing = await db.select({ id: items.id }).from(items).where(eq(items.urlHash, hash)).limit(1);
  if (existing[0]) return existingResult(db, hash);

  const media = detectAdhocMedia(rawUrl);
  const contentType = media ? media.contentType : initialContentType(rawUrl);

  const inserted = await db
    .insert(items)
    .values({
      sourceId: null,
      externalId: null,
      url: rawUrl,
      urlHash: hash,
      title: rawUrl, // URL placeholder; extract overwrites it via resolveTitle once the adapter finds a real title
      contentType,
      mediaUrl: media ? rawUrl : null, // for direct-media the canonical url IS the download source
      rawContent: null,
      state: 'pending',
      currentStage: 'extract',
    })
    .onConflictDoNothing()
    .returning({ id: items.id });

  // Lost the insert race against a concurrent paste of the same url → treat as dup.
  if (!inserted[0]) return existingResult(db, hash);

  const boss = await getBoss();
  await registerQueues(boss); // idempotent; ensures the extract queue exists
  await enqueueStage(boss, 'extract', inserted[0].id);
  return { created: inserted[0].id };
}
