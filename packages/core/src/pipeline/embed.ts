import { eq } from 'drizzle-orm';
import { embedMany } from 'ai';
import { getDbClient, items, itemEmbeddings } from '../db';
import { env } from '../config/env';
import { resolveEmbedding, embeddingProviderOptions } from '../ai';
import { buildEmbeddingConfig, getUserSettings } from '../settings';
import { buildEmbeddingInputs } from './embedding-input';

export async function embedItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  const settings = await getUserSettings();
  if (!settings) throw new Error('user_settings not initialized');
  const cfg = buildEmbeddingConfig(settings);
  const model = resolveEmbedding(cfg);

  const { docText, titleText } = buildEmbeddingInputs(item);

  // One round-trip for both vectors. Order matches values: [doc, title].
  const { embeddings } = await embedMany({
    model,
    values: [docText, titleText],
    providerOptions: embeddingProviderOptions(cfg),
  });
  const [embedding, titleEmbedding] = embeddings;
  if (!embedding || !titleEmbedding) {
    throw new Error(`Embedding provider returned ${embeddings.length} vectors, expected 2`);
  }

  // Hard invariant: vector(N) is frozen at install time. A model whose output
  // dim != EMBED_DIM must fail loudly, not corrupt the table.
  if (embedding.length !== env.EMBED_DIM) {
    throw new Error(
      `Embedding dim mismatch: model '${cfg.model}' returned ${embedding.length}, schema expects ${env.EMBED_DIM}. ` +
        `If this is a higher-dimension MRL model, enable "request output dimensions" in settings to truncate to ${env.EMBED_DIM}; ` +
        `otherwise switch to a model that outputs ${env.EMBED_DIM} dims, or re-init at EMBED_DIM=${embedding.length}.`,
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
