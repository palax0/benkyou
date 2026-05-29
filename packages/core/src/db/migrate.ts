import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  await migrate(db, {
    migrationsFolder: resolve(__dirname, './migrations'),
  });
  await client.end();
}
