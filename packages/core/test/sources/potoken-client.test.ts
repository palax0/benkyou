import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchAnonymousPoToken, pingPotokenSidecar } from '../../src/sources/potoken-client.js';

afterEach(() => vi.restoreAllMocks());

describe('fetchAnonymousPoToken', () => {
  test('POSTs visitor_data as content_binding and returns po_token', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ po_token: 'POT123', content_binding: 'VD' }), { status: 200 }),
    );
    const tok = await fetchAnonymousPoToken('http://sidecar:4416', 'VD');
    expect(tok).toBe('POT123');
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://sidecar:4416/get_pot');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ content_binding: 'VD' });
  });

  test('throws on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(fetchAnonymousPoToken('http://sidecar:4416', 'VD')).rejects.toThrow(/500/);
  });

  test('throws when po_token missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(fetchAnonymousPoToken('http://sidecar:4416', 'VD')).rejects.toThrow(/po_token/);
  });
});

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
