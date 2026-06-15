import { eq } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import { urlHash } from '../util/url';
import { detectAdhocType } from '../sources';
import { getBoss, registerQueues, enqueueStage } from '../queue';

export interface PasteResult {
  created?: string; // new item id (pipeline started)
  existing?: string; // dup hit — frontend navigates here
}

// Initial content_type so the feed/progress UI shows the right kind before extract
// runs. extract overwrites it from the adapter's ExtractResult.
function initialContentType(url: string): 'article' | 'video' {
  return detectAdhocType(url) === 'article' ? 'article' : 'video';
}

export async function pasteUrl(rawUrl: string): Promise<PasteResult> {
  const db = getDbClient();
  const hash = urlHash(rawUrl);

  const existing = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.urlHash, hash))
    .limit(1);
  if (existing[0]) return { existing: existing[0].id };

  const inserted = await db
    .insert(items)
    .values({
      sourceId: null,
      externalId: null,
      url: rawUrl,
      urlHash: hash,
      title: rawUrl, // URL placeholder; extract overwrites it via resolveTitle once the adapter finds a real title
      contentType: initialContentType(rawUrl),
      rawContent: null,
      state: 'pending',
      currentStage: 'extract',
    })
    .onConflictDoNothing()
    .returning({ id: items.id });

  // Lost the insert race against a concurrent paste of the same url → treat as dup.
  if (!inserted[0]) {
    const row = await db.select({ id: items.id }).from(items).where(eq(items.urlHash, hash)).limit(1);
    return { existing: row[0]!.id };
  }

  const boss = await getBoss();
  await registerQueues(boss); // idempotent; ensures the extract queue exists
  await enqueueStage(boss, 'extract', inserted[0].id);
  return { created: inserted[0].id };
}
