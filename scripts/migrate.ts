import { runMigrations } from '@benkyou/core/db/migrate';
import { assertEnv, env } from '@benkyou/core/config';

assertEnv();
await runMigrations(env.DATABASE_URL);
console.log('✓ Migrations applied');
