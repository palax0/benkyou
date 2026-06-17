import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

export type TestDatabase = {
  url: string;
  sql: postgres.Sql;
  cleanup: () => Promise<void>;
};

// The seam between globalSetup (writer) and the per-test helpers (reader).
// Both sides must agree on these names; keep them defined here only.
export const ADMIN_URL_ENV = 'BENKYOU_TEST_DATABASE_ADMIN_URL';
export const TEMPLATE_DB_ENV = 'BENKYOU_TEST_DATABASE_TEMPLATE';

const dbBackedTestPatterns = [
  '.int.test.ts',
  'test/db.test.ts',
  'test/boss.test.ts',
];

export function shouldUseSharedDatabase(args: readonly string[]): boolean {
  const filters = args.filter((arg) => !arg.startsWith('-') && arg !== 'run');
  if (filters.length === 0) return true;
  return filters.some((arg) =>
    dbBackedTestPatterns.some((pattern) => arg.includes(pattern)),
  );
}

export function testDatabaseName(label: string, suffix: string = randomUUID()): string {
  const safeLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const safeSuffix = suffix.replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 12);
  return `test_${safeLabel || 'db'}_${safeSuffix}`;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function buildDatabaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function terminateDatabaseConnections(
  adminSql: postgres.Sql,
  databaseName: string,
): Promise<void> {
  await adminSql`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = ${databaseName}
      AND pid <> pg_backend_pid()
  `;
}

async function createDatabase(
  adminSql: postgres.Sql,
  databaseName: string,
  templateName?: string,
): Promise<void> {
  const database = quoteIdentifier(databaseName);
  if (templateName) {
    await terminateDatabaseConnections(adminSql, templateName);
    await adminSql.unsafe(
      `CREATE DATABASE ${database} TEMPLATE ${quoteIdentifier(templateName)}`,
    );
    return;
  }

  await adminSql.unsafe(`CREATE DATABASE ${database}`);
}

async function dropDatabase(adminUrl: string, databaseName: string): Promise<void> {
  const adminSql = postgres(adminUrl, { max: 1 });
  try {
    await terminateDatabaseConnections(adminSql, databaseName);
    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  } finally {
    await adminSql.end();
  }
}

async function createTestDatabase(
  label: string,
  templateName?: string,
): Promise<TestDatabase> {
  const adminUrl = process.env[ADMIN_URL_ENV];
  if (!adminUrl) {
    throw new Error(`${ADMIN_URL_ENV} is not set; shared test database setup did not run`);
  }

  const databaseName = testDatabaseName(label);
  const adminSql = postgres(adminUrl, { max: 1 });
  try {
    await createDatabase(adminSql, databaseName, templateName);
  } finally {
    await adminSql.end();
  }

  const url = buildDatabaseUrl(adminUrl, databaseName);
  const sql = postgres(url);
  process.env.DATABASE_URL = url;
  process.env.EMBED_DIM = '1536';
  process.env.SESSION_SECRET = 'a'.repeat(40);

  return {
    url,
    sql,
    cleanup: async () => {
      // Dynamic import, never hoisted to a top-level import: client.js → env.ts
      // reads process.env at load, so importing it before DATABASE_URL is set
      // above would cache the wrong value. closeDbClient() is a no-op when the
      // cached client was never created (suites using db.sql directly).
      const { closeDbClient } = await import('../../src/db/client.js');
      await closeDbClient();
      await sql.end();
      await dropDatabase(adminUrl, databaseName);
    },
  };
}

export async function createMigratedTestDatabase(label: string): Promise<TestDatabase> {
  const templateName = process.env[TEMPLATE_DB_ENV];
  if (!templateName) {
    throw new Error(`${TEMPLATE_DB_ENV} is not set; shared test database setup did not run`);
  }
  return createTestDatabase(label, templateName);
}

export async function createEmptyTestDatabase(label: string): Promise<TestDatabase> {
  return createTestDatabase(label);
}
