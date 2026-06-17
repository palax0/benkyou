import { describe, expect, test } from 'vitest';
import { assertSafeE2eDatabaseUrl } from '../e2e/global-setup';

describe('e2e database URL guard', () => {
  test('rejects the development database before truncating e2e data', () => {
    expect(() =>
      assertSafeE2eDatabaseUrl('postgres://benkyou:benkyou@localhost:5432/benkyou'),
    ).toThrow(/must point at a dedicated e2e database/i);
  });

  test('accepts the dedicated e2e database', () => {
    expect(() =>
      assertSafeE2eDatabaseUrl('postgres://benkyou:benkyou@localhost:5432/benkyou_e2e'),
    ).not.toThrow();
  });

  test('accepts the _e2e suffix case-insensitively', () => {
    expect(() =>
      assertSafeE2eDatabaseUrl('postgres://benkyou:benkyou@localhost:5432/benkyou_E2E'),
    ).not.toThrow();
  });

  test('rejects an e2e_ prefix on a real database name', () => {
    expect(() =>
      assertSafeE2eDatabaseUrl('postgres://benkyou:benkyou@localhost:5432/e2e_prod'),
    ).toThrow(/must point at a dedicated e2e database/i);
  });
});
