import { describe, expect, test } from 'vitest';
import {
  buildDatabaseUrl,
  quoteIdentifier,
  shouldUseSharedDatabase,
  testDatabaseName,
} from './helpers';

describe('shared database test harness helpers', () => {
  test('builds deterministic safe database names from labels', () => {
    expect(testDatabaseName('items/feed-filter.int.test.ts', 'abc123')).toBe(
      'test_items_feed_filter_int_test_ts_abc123',
    );
  });

  test('quotes postgres identifiers safely', () => {
    expect(quoteIdentifier('plain_name')).toBe('"plain_name"');
    expect(quoteIdentifier('bad"name')).toBe('"bad""name"');
  });

  test('switches database names without changing credentials or host', () => {
    expect(buildDatabaseUrl('postgres://u:p@localhost:5432/postgres', 'case_db')).toBe(
      'postgres://u:p@localhost:5432/case_db',
    );
  });

  test('uses shared database setup for full or integration test runs only', () => {
    expect(shouldUseSharedDatabase(['run'])).toBe(true);
    expect(shouldUseSharedDatabase(['run', 'test/items/feed-filter.int.test.ts'])).toBe(true);
    expect(shouldUseSharedDatabase(['run', 'test/db.test.ts'])).toBe(true);
    expect(shouldUseSharedDatabase(['run', 'test/util/text.test.ts'])).toBe(false);
  });
});
