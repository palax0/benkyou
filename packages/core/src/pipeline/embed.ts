import { eq } from 'drizzle-orm';
import { embedMany } from 'ai';
import { getDbClient, items, itemEmbeddings } from '../db';
import { env } from '../config/env';
import { resolveEmbedding } from '../ai';
import { buildEmbeddingConfig, getUserSettings } from '../settings';
import { truncateChars } from '../util/text';

const MAX_CONTENT_CHARS = 16_000; // ~4k tokens of body text (spec §6.2 embed)

export async function embedItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  const settings = await getUserSettings();
  if (!settings) throw new Error('user_settings not initialized');
  const cfg = buildEmbeddingConfig(settings);
  const model = resolveEmbedding(cfg);

  const body = truncateChars(item.rawContent, MAX_CONTENT_CHARS);
  const docText = body ? `${item.title}\n\n${body}` : item.title;

  // One round-trip for both vectors. Order matches values: [doc, title].
  const { embeddings } = await embedMany({ model, values: [docText, item.title] });
  const [embedding, titleEmbedding] = embeddings;
  if (!embedding || !titleEmbedding) {
    throw new Error(`Embedding provider returned ${embeddings.length} vectors, expected 2`);
  }

  // Hard invariant: vector(N) is frozen at install time. A model whose output
  // dim != EMBED_DIM must fail loudly, not corrupt the table.
  if (embedding.length !== env.EMBED_DIM) {
    throw new Error(
      `Embedding dim mismatch: model '${cfg.model}' returned ${embedding.length}, schema expects ${env.EMBED_DIM}. ` +
        `Fix embed_model, or run scripts/migrate-embeddings.ts --new-dim=${embedding.length}.`,
    );
  }

  await db
    .insert(itemEmbeddings)
    .values({ itemId, embedding, titleEmb: titleEmbedding, modelId: cfg.model })
    .onConflictDoUpdate({
      target: itemEmbeddings.itemId,
      set: { embedding, titleEmb: titleEmbedding, modelId: cfg.model },
    });
}
