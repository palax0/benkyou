import { afterEach, describe, expect, test, vi } from 'vitest';
import { pingPotokenSidecar } from '../../src/sources/potoken-health.js';

afterEach(() => vi.restoreAllMocks());

describe('pingPotokenSidecar', () => {
  test('true on 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await pingPotokenSidecar('http://sidecar:4416')).toBe(true);
  });
  test('false on error / non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await pingPotokenSidecar('http://sidecar:4416')).toBe(false);
  });
});
