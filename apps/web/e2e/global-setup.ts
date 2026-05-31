import postgres from 'postgres';
import { runMigrations } from '@benkyou/core/db/migrate';
import { hashPassword } from '@benkyou/core/auth';

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou';

export default async function globalSetup(): Promise<void> {
  // Assumes `docker compose up -d postgres` is already running (CI does this first).
  // Call core migration directly rather than shelling out (avoids cwd issues in monorepo).
  process.env['DATABASE_URL'] = DATABASE_URL;
  process.env['EMBED_DIM'] = process.env['EMBED_DIM'] ?? '1536';
  process.env['SESSION_SECRET'] =
    process.env['SESSION_SECRET'] ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await runMigrations(DATABASE_URL);

  const sql = postgres(DATABASE_URL);
  try {
    await sql`TRUNCATE items, item_embeddings, sessions, sources, user_settings, event_clusters RESTART IDENTITY CASCADE`;
    const passwordHash = await hashPassword('e2e-password');
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, locale, llm_provider, llm_model, embed_provider, embed_model)
      VALUES (1, ${passwordHash}, 1536, 'en', 'openai', 'gpt-x', 'openai', 'emb-x')`;
    await sql`INSERT INTO sources (id, type, name, config)
      VALUES ('11111111-1111-1111-1111-111111111111', 'rss', 'Seed Feed', '{"url":"x"}')`;
    await sql`INSERT INTO items
      (id, source_id, url, url_hash, title, summary, raw_content, deep_summary, content_type, state, published_at, depth_score, category)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',
        'https://example.com/seeded','seedhash','Seeded Article','A seeded summary line.',
        'Full seeded body content.','TL;DR seeded deep summary.','article','done', now(), '0.6','knowledge')`;
  } finally {
    await sql.end();
  }
}
