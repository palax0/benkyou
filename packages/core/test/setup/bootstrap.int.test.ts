import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';

type SetupModule = typeof import('../../src/setup/index.js');
type SettingsModule = typeof import('../../src/settings/index.js');

describe('completeSetup (password-only bootstrap)', () => {
  let db: TestDatabase;
  let setup: SetupModule;
  let settings: SettingsModule;
  let closeDbClient: () => Promise<void>;

  beforeAll(async () => {
    db = await createMigratedTestDatabase('setup/bootstrap.int.test');
    setup = await import('../../src/setup/index.js');
    settings = await import('../../src/settings/index.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 180_000);

  afterAll(async () => {
    await closeDbClient?.();
    await db?.cleanup();
  });

  test('creates the row with password + locale, provider columns NULL → bootstrapped', async () => {
    const res = await setup.completeSetup({ password: 'hunter2hunter2', locale: 'zh' });
    expect(res.inserted).toBe(true);
    const s = await settings.getUserSettings();
    expect(s?.llmProvider).toBeNull();
    expect(s?.embedProvider).toBeNull();
    expect(s?.embedDim).toBeGreaterThan(0); // from env.EMBED_DIM
    expect(settings.aiReadiness(s!)).toBe('bootstrapped');
  });

  test('second call is a no-op (single row id=1)', async () => {
    const res = await setup.completeSetup({ password: 'other', locale: 'en' });
    expect(res.inserted).toBe(false);
  });
});
