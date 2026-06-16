import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { runMigrations } from '../../src/db/migrate.js';
import { buildDatabaseUrl, quoteIdentifier } from './helpers';
import postgres from 'postgres';

const TEMPLATE_DATABASE = 'benkyou_test_template';

let container: StartedTestContainer | null = null;

export async function setup(): Promise<void> {
  container = await new GenericContainer('pgvector/pgvector:pg16')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'postgres',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .start();

  const adminUrl = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/postgres`;
  const templateUrl = buildDatabaseUrl(adminUrl, TEMPLATE_DATABASE);
  const adminSql = postgres(adminUrl, { max: 1 });

  try {
    await adminSql.unsafe(`CREATE DATABASE ${quoteIdentifier(TEMPLATE_DATABASE)}`);
  } finally {
    await adminSql.end();
  }

  process.env.EMBED_DIM = '1536';
  process.env.SESSION_SECRET = 'a'.repeat(40);
  await runMigrations(templateUrl);

  process.env.BENKYOU_TEST_DATABASE_ADMIN_URL = adminUrl;
  process.env.BENKYOU_TEST_DATABASE_TEMPLATE = TEMPLATE_DATABASE;
}

export async function teardown(): Promise<void> {
  await container?.stop();
  container = null;
}
