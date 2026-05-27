import { PgBoss } from 'pg-boss';
import { env } from '../config/env.js';

let _boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss;
  // pg-boss 12 moved retry and retention settings from constructor to
  // per-queue QueueOptions; those are set when registering queues in M1+.
  _boss = new PgBoss({ connectionString: env.DATABASE_URL });
  await _boss.start();
  return _boss;
}

export async function closeBoss(): Promise<void> {
  if (_boss) {
    await _boss.stop({ graceful: true, timeout: 5_000 });
    _boss = null;
  }
}
