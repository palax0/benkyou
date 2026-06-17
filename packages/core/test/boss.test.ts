import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from './db-harness/helpers';

// config/env.ts validates process.env at module-evaluation time, and boss.ts
// statically imports it. A static `import ... from '../src/queue/boss.js'`
// would evaluate env.ts before beforeAll runs (ESM imports are hoisted), so we
// defer the import until DATABASE_URL/EMBED_DIM/SESSION_SECRET are set below.
type BossModule = typeof import('../src/queue/boss.js');

describe('pg-boss wrapper', () => {
  let db: TestDatabase;
  let getBoss: BossModule['getBoss'];
  let closeBoss: BossModule['closeBoss'];

  beforeAll(async () => {
    db = await createMigratedTestDatabase('boss');
    ({ getBoss, closeBoss } = await import('../src/queue/boss.js'));
  }, 120_000);

  afterAll(async () => {
    await closeBoss?.();
    await db?.cleanup();
  });

  test('starts pg-boss and can enqueue/process a job', async () => {
    const boss = await getBoss();
    let received: { msg: string } | null = null;
    await boss.createQueue('test-queue');
    // Default poll interval is 2s; shorten it so the worker picks the job up
    // quickly and the condition poll below stays well within the test timeout.
    await boss.work<{ msg: string }>(
      'test-queue',
      { pollingIntervalSeconds: 0.5 },
      async ([job]) => {
        if (job) received = job.data;
      },
    );
    await boss.send('test-queue', { msg: 'hi' });
    const deadline = Date.now() + 10_000;
    while (received === null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(received).toEqual({ msg: 'hi' });
  });
});
