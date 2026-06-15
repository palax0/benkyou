import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchViaReader } from '../../src/sources/reader.js';

const BASE = 'https://reader.test';
const TARGET = 'https://site.test/article?id=42';

// The reader appends a full absolute target URL onto the base, so the request path
// embeds another `https://…?…`. MSW's path-to-regexp matcher chokes on the nested
// `:` and `?`, so handlers match the base with a wildcard and assert the appended
// target/query via `request.url` inside the resolver.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchViaReader', () => {
  test('200 markdown → { ok: true }, and URL is base + full target (query kept)', async () => {
    let seenUrl = '';
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/*`, ({ request }) => {
        seenUrl = request.url;
        seenAuth = request.headers.get('authorization');
        return new HttpResponse('# Heading\n\nReal body.', { headers: { 'content-type': 'text/markdown' } });
      }),
    );
    const r = await fetchViaReader(TARGET, { baseUrl: `${BASE}/`, apiKey: 'k' });
    expect(r).toEqual({ ok: true, markdown: '# Heading\n\nReal body.' });
    expect(seenUrl).toContain('id=42'); // query string preserved
    expect(seenAuth).toBe('Bearer k');
  });

  test('omits Authorization header when no apiKey', async () => {
    let seenAuth: string | null = 'unset';
    server.use(
      http.get(`${BASE}/*`, ({ request }) => {
        seenAuth = request.headers.get('authorization');
        return new HttpResponse('# x\n\nbody', {});
      }),
    );
    await fetchViaReader(TARGET, { baseUrl: BASE });
    expect(seenAuth).toBeNull();
  });

  test('403 → blocked', async () => {
    server.use(http.get(`${BASE}/*`, () => new HttpResponse(null, { status: 403 })));
    expect(await fetchViaReader(TARGET, { baseUrl: BASE })).toEqual({ ok: false, reason: 'blocked' });
  });

  test('cf-mitigated challenge header → blocked', async () => {
    server.use(
      http.get(`${BASE}/*`, () => new HttpResponse(null, { status: 503, headers: { 'cf-mitigated': 'challenge' } })),
    );
    expect(await fetchViaReader(TARGET, { baseUrl: BASE })).toEqual({ ok: false, reason: 'blocked' });
  });

  test('5xx → fetch_failed', async () => {
    server.use(http.get(`${BASE}/*`, () => new HttpResponse(null, { status: 502 })));
    expect(await fetchViaReader(TARGET, { baseUrl: BASE })).toEqual({ ok: false, reason: 'fetch_failed' });
  });

  test('network throw → fetch_failed', async () => {
    server.use(http.get(`${BASE}/*`, () => { throw new Error('boom'); }));
    expect(await fetchViaReader(TARGET, { baseUrl: BASE })).toEqual({ ok: false, reason: 'fetch_failed' });
  });

  test('200 but empty body → empty_parse', async () => {
    server.use(http.get(`${BASE}/*`, () => new HttpResponse('   ', {})));
    expect(await fetchViaReader(TARGET, { baseUrl: BASE })).toEqual({ ok: false, reason: 'empty_parse' });
  });

  test('200 but body read rejects → fetch_failed (degrade, never throw)', async () => {
    const fake = {
      status: 200,
      ok: true,
      headers: new Headers(),
      text: () => Promise.reject(new Error('stream aborted')),
    } as unknown as Response;
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(fake);
    try {
      expect(await fetchViaReader(TARGET, { baseUrl: BASE })).toEqual({ ok: false, reason: 'fetch_failed' });
    } finally {
      spy.mockRestore();
    }
  });
});
