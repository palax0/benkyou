import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../config/env.js';

let _client: postgres.Sql | null = null;

export function getDbClient() {
  if (!_client) {
    _client = postgres(env.DATABASE_URL, { max: 20, prepare: false });
  }
  return drizzle(_client);
}

export async function closeDbClient() {
  if (_client) {
    await _client.end();
    _client = null;
  }
}
