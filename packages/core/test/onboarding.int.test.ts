import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from './db-harness/helpers';
import postgres from 'postgres';

type OnboardingModule = typeof import('../src/onboarding.js');
type SetupModule = typeof import('../src/setup/index.js');
const SOURCE = '66666666-6666-6666-6666-666666666666';

describe('getOnboardingState', () => {
  let db: TestDatabase;
  let sql: postgres.Sql;
  let onboarding: OnboardingModule;
  let setup: SetupModule;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('onboarding.int.test');
    sql = db.sql;
    setup = await import('../src/setup/index.js');
    onboarding = await import('../src/onboarding.js');
    ({ closeDbClient } = await import('../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('fresh bootstrap → all false', async () => {
    await setup.completeSetup({ password: 'hunter2hunter2', locale: 'zh' });
    expect(await onboarding.getOnboardingState()).toEqual({
      aiConfigured: false, hasSource: false, hasItem: false, hasDone: false,
    });
  });

  test('reflects source + item + done presence', async () => {
    await sql`INSERT INTO sources (id, type, name, config) VALUES
      (${SOURCE}, 'rss', 'Feed', '{"url":"https://x.example.com"}')`;
    await sql`INSERT INTO items (source_id, url, url_hash, title, content_type, state) VALUES
      (${SOURCE}, 'https://x/1', 'h1', 'Pending', 'article', 'pending'),
      (${SOURCE}, 'https://x/2', 'h2', 'Done',    'article', 'done')`;
    const s = await onboarding.getOnboardingState();
    expect(s.hasSource).toBe(true);
    expect(s.hasItem).toBe(true);
    expect(s.hasDone).toBe(true);
  });
});
