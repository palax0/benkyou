import { runMigrations } from '@benkyou/core/db/migrate';
import { env } from '@benkyou/core/config';

await runMigrations(env.DATABASE_URL);
console.log('✓ Migrations applied');
