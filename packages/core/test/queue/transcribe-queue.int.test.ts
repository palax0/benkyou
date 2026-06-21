import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import type { PgBoss } from 'pg-boss';

describe('transcribe queue registration', () => {
  let db: TestDatabase; let boss: PgBoss;
  let registerQueues: (b: PgBoss) => Promise<void>;
  let closeBoss: () => Promise<void>; let closeDbClient: () => Promise<void>;
  // Loaded dynamically after createMigratedTestDatabase sets DATABASE_URL — static
  // importing queues.js would evaluate env.ts before DATABASE_URL is in process.env.
  let TRANSCRIBE_EXPIRY_BACKSTOP_SEC: number;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('queue/transcribe-queue.int.test');
    const q = await import('../../src/queue/index.js');
    registerQueues = q.registerQueues; closeBoss = q.closeBoss; boss = await q.getBoss();
    TRANSCRIBE_EXPIRY_BACKSTOP_SEC = q.TRANSCRIBE_EXPIRY_BACKSTOP_SEC;
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  test('transcribe queue has retryLimit 2 + its own dead-letter, independent of pipeline_max_attempts', async () => {
    await registerQueues(boss);
    const q = await boss.getQueue('transcribe');
    expect(q?.retryLimit).toBe(2);
    expect(q?.deadLetter).toBe('transcribe-failed');
    const dl = await boss.getQueue('transcribe-failed');
    expect(dl).toBeTruthy();
  });

  test('transcribe queue backstop expiry is TRANSCRIBE_EXPIRY_BACKSTOP_SEC and under pg-boss 24h ceiling', async () => {
    await registerQueues(boss);
    const q = await boss.getQueue('transcribe');
    // Regression guard: if TRANSCRIBE_EXPIRY_BACKSTOP_SEC is ever bumped past 86399
    // pg-boss will reject the queue registration at startup (validates expireInSeconds / 3600 < 24).
    expect(TRANSCRIBE_EXPIRY_BACKSTOP_SEC).toBeLessThan(24 * 3600);
    expect(q?.expireInSeconds).toBe(TRANSCRIBE_EXPIRY_BACKSTOP_SEC);
  });
});
