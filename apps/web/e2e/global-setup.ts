import postgres from 'postgres';
import { runMigrations } from '@benkyou/core/db/migrate';
import { hashPassword } from '@benkyou/core/auth';

// Dedicated e2e database — this file TRUNCATEs every run, so it must never
// point at the dev DB (`…/benkyou`). Override with E2E_DATABASE_URL in CI.
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou_e2e';

// Creates the e2e database on a fresh postgres volume. Playwright starts the
// webServer entries BEFORE globalSetup, so the dev server's readiness probe must
// not depend on this having run yet (hence the DB-free /health probe in config).
async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!databaseName) {
    throw new Error('E2E_DATABASE_URL must include a database name');
  }
  url.pathname = '/postgres';
  const sql = postgres(url.toString(), { max: 1 });
  try {
    const rows = await sql<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${databaseName}) AS "exists"`;
    if (!rows[0]?.exists) {
      // CREATE DATABASE can't take a bind parameter, so quote the identifier manually.
      await sql.unsafe(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
    }
  } finally {
    await sql.end();
  }
}

export default async function globalSetup(): Promise<void> {
  // Assumes the postgres container is up (`docker compose up -d postgres`).
  // Call core migration directly rather than shelling out (avoids cwd issues in monorepo).
  process.env['DATABASE_URL'] = DATABASE_URL;
  process.env['EMBED_DIM'] = process.env['EMBED_DIM'] ?? '1536';
  process.env['SESSION_SECRET'] =
    process.env['SESSION_SECRET'] ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await ensureDatabaseExists(DATABASE_URL);
  await runMigrations(DATABASE_URL);

  const sql = postgres(DATABASE_URL);
  try {
    await sql`TRUNCATE items, item_embeddings, sessions, sources, user_settings, event_clusters RESTART IDENTITY CASCADE`;
    const passwordHash = await hashPassword('e2e-password');
    // Point the pipeline's AI calls at the provider mock (a real listener on
    // :4599) so ingest→done runs offline. embed_request_dimensions is left at its
    // default (false) here because embedding-dimensions.spec asserts the toggle
    // starts unchecked; the sources flow that needs the mock's 3072 truncated to
    // 1536 enables it in its own beforeAll.
    await sql`INSERT INTO user_settings
      (id, password_hash, embed_dim, locale,
       llm_provider, llm_base_url, llm_model, llm_cheap_model,
       embed_provider, embed_base_url, embed_model)
      VALUES (1, ${passwordHash}, 1536, 'en',
        'openai-compatible', 'http://localhost:4599/v1', 'mock-llm', 'mock-llm',
        'openai-compatible', 'http://localhost:4599/v1', 'mock-embed')`;
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
