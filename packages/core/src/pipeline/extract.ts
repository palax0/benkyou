import { eq } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { getDbClient, items } from '../db';

// Below this many chars we assume the feed only gave us a blurb and fetch the
// real article. Article-fetch failures degrade (keep whatever we had) rather
// than failing the stage — spec §6.2: pipeline continues even without full text.
const FULLTEXT_MIN_CHARS = 600;

export async function fetchReadable(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'benkyou/0.1 (+readability)' } });
    if (!res.ok) return null;
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const text = article?.textContent?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export async function extractItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  let content = item.rawContent ?? '';
  if (content.length < FULLTEXT_MIN_CHARS && item.url) {
    const fetched = await fetchReadable(item.url);
    if (fetched && fetched.length > content.length) content = fetched;
  }

  await db
    .update(items)
    .set({ rawContent: content.length > 0 ? content : null, contentType: 'article' })
    .where(eq(items.id, itemId));
}
