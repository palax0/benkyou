import { describe, expect, test } from 'vitest';
import { deriveBilibiliStatus } from '../../src/sources/credential-status.js';

const NOW = Date.parse('2026-06-22T00:00:00Z');

describe('deriveBilibiliStatus', () => {
  test('no row → unset', () => {
    expect(deriveBilibiliStatus(null, NOW)).toBe('unset');
  });
  test('secret present, no expiry → valid', () => {
    expect(deriveBilibiliStatus({ secret: 'SD', meta: null }, NOW)).toBe('valid');
  });
  test('secret present, expiry in future → valid', () => {
    expect(deriveBilibiliStatus({ secret: 'SD', meta: { expiresAt: NOW + 1000 } }, NOW)).toBe('valid');
  });
  test('secret present, expiry in past → expired', () => {
    expect(deriveBilibiliStatus({ secret: 'SD', meta: { expiresAt: NOW - 1000 } }, NOW)).toBe('expired');
  });
  test('null secret → unset', () => {
    expect(deriveBilibiliStatus({ secret: null, meta: { expiresAt: NOW + 1000 } }, NOW)).toBe('unset');
  });
});
