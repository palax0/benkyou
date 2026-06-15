import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { extractArticle, fetchReadable, resolveContent } from '../../src/sources/extract-article.js';

const ARTICLE_HTML = `<!doctype html><html><head><title>T</title></head><body>
  <nav>menu junk</nav>
  <article><h1>Real Title</h1>
    <p>This is the first substantive paragraph of the real article body that Readability should keep.</p>
    <p>And a second paragraph with more meaningful content to clear the length threshold.</p>
  </article>
  <footer>footer junk</footer>
</body></html>`;

const server = setupServer(
  http.get('https://site.test/article', () =>
    new HttpResponse(ARTICLE_HTML, { headers: { 'content-type': 'text/html' } }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchReadable', () => {
  test('returns ok markdown, dropping nav/footer', async () => {
    const r = await fetchReadable('https://site.test/article');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.markdown).toContain('first substantive paragraph');
      expect(r.markdown).not.toContain('menu junk');
      expect(r.markdown).not.toContain('footer junk');
    }
  });

  test('403 → blocked (degrade, do not throw)', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 403 })));
    expect(await fetchReadable('https://site.test/article')).toEqual({ ok: false, reason: 'blocked' });
  });

  test('cf-mitigated header → blocked', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 503, headers: { 'cf-mitigated': 'challenge' } })));
    expect(await fetchReadable('https://site.test/article')).toEqual({ ok: false, reason: 'blocked' });
  });

  test('5xx → fetch_failed', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 500 })));
    expect(await fetchReadable('https://site.test/article')).toEqual({ ok: false, reason: 'fetch_failed' });
  });

  test('200 but Readability finds nothing → empty_parse', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse('<html><body><div></div></body></html>', { headers: { 'content-type': 'text/html' } })));
    expect(await fetchReadable('https://site.test/article')).toEqual({ ok: false, reason: 'empty_parse' });
  });

  test('ok outcome carries the Readability title', async () => {
    const r = await fetchReadable('https://site.test/article');
    expect(r.ok).toBe(true);
    if (r.ok) expect(typeof r.title === 'string' && r.title.length > 0).toBe(true);
  });
});

describe('resolveContent', () => {
  // ~190 chars of text padded with markup + a long tracking URL well past 600 raw chars:
  // the threshold must judge PLAIN-TEXT length, not markdown length (long link URL must not inflate it).
  const BLURB_HTML =
    '<p>' + 'A short feed excerpt that teases the article without giving the body. '.repeat(2) + '</p>' +
    `<p><a href="https://site.test/article?utm_campaign=${'x'.repeat(260)}">Read more</a></p>`;

  test('adequate feed → no fetch, ok, dual-write', async () => {
    const full = `<p>${'Substantive feed body sentence. '.repeat(20)}</p>`;
    const r = await resolveContent(full, 'https://site.test/never-fetched');
    expect(r.extractStatus).toBe('ok');
    expect(r.contentMd).toContain('Substantive feed body');
    expect(r.rawContent).toContain('Substantive feed body');
    expect(r.rawContent).not.toContain('<p>');
  });

  test('blurb (HTML-inflated, long link) still triggers direct fetch; direct wins → ok', async () => {
    const r = await resolveContent(BLURB_HTML, 'https://site.test/article');
    expect(r.extractStatus).toBe('ok');
    expect(r.contentMd).toContain('first substantive paragraph');
    expect(r.rawContent).toContain('first substantive paragraph');
  });

  test('legit short article (direct ok but < threshold, no reader) → ok, not misjudged as failure', async () => {
    server.use(http.get('https://site.test/short', () => new HttpResponse(
      '<article><p>Short but real and complete.</p></article>', { headers: { 'content-type': 'text/html' } })));
    const r = await resolveContent(null, 'https://site.test/short');
    expect(r.extractStatus).toBe('ok');
    expect(r.contentMd).toContain('Short but real and complete');
  });

  test('direct ok (short) + reader ok (shorter) → ok, the longer direct body wins (plain-text best-of)', async () => {
    server.use(
      http.get('https://site.test/short', () => new HttpResponse(
        '<article><p>Short but real and complete article body.</p></article>', { headers: { 'content-type': 'text/html' } })),
      http.get('https://reader.test/*', () => new HttpResponse('tiny', {})),
    );
    const r = await resolveContent(null, 'https://site.test/short', { baseUrl: 'https://reader.test' });
    expect(r.extractStatus).toBe('ok');
    expect(r.contentMd).toContain('Short but real and complete');
    expect(r.contentMd).not.toBe('tiny'); // shorter reader candidate must not win
  });

  test('direct 403, no reader, empty feed → content null, status blocked', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 403 })));
    const r = await resolveContent(null, 'https://site.test/article');
    expect(r.contentMd).toBeNull();
    expect(r.rawContent).toBeNull();
    expect(r.extractStatus).toBe('blocked');
  });

  test('PARTIAL: blurb feed + direct 403, no reader → content_md non-empty (blurb), status blocked', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 403 })));
    const r = await resolveContent(BLURB_HTML, 'https://site.test/article');
    expect(r.contentMd).toContain('A short feed excerpt');
    expect(r.extractStatus).toBe('blocked');
  });

  test('reader configured + direct insufficient → reader markdown wins → ok', async () => {
    server.use(
      http.get('https://site.test/article', () => new HttpResponse(null, { status: 403 })),
      http.get('https://reader.test/*', () =>
        new HttpResponse(`# Full\n\n${'Reader-provided real body sentence. '.repeat(20)}`, {})),
    );
    const r = await resolveContent(null, 'https://site.test/article', { baseUrl: 'https://reader.test' });
    expect(r.extractStatus).toBe('ok');
    expect(r.contentMd).toContain('Reader-provided real body');
  });

  test('FAILURE PRIORITY: direct blocked + reader fetch_failed → final blocked (not overwritten)', async () => {
    server.use(
      http.get('https://site.test/article', () => new HttpResponse(null, { status: 403 })),
      http.get('https://reader.test/*', () => new HttpResponse(null, { status: 500 })),
    );
    const r = await resolveContent(null, 'https://site.test/article', { baseUrl: 'https://reader.test' });
    expect(r.contentMd).toBeNull();
    expect(r.extractStatus).toBe('blocked');
  });

  test('no content + no url → empty result', async () => {
    const r = await resolveContent(null, null);
    expect(r).toEqual({ contentMd: null, rawContent: null, extractStatus: 'ok', title: null });
  });

  test('direct fetch title flows into ResolvedContent.title', async () => {
    const r = await resolveContent(null, 'https://site.test/article');
    expect(r.title && r.title.length > 0).toBeTruthy();
  });

  test('feed-only (no fetch) leaves title null — feed title lives on the item already', async () => {
    const full = `<p>${'Substantive feed body sentence. '.repeat(20)}</p>`;
    const r = await resolveContent(full, 'https://site.test/never-fetched');
    expect(r.title).toBeNull();
  });
});

describe('extractArticle', () => {
  test('adequate feed → article, na transcript, ok status, dual content', async () => {
    const full = `<p>${'Substantive feed body sentence. '.repeat(20)}</p>`;
    const r = await extractArticle({ url: 'https://site.test/never-fetched', rawContent: full, externalId: null });
    expect(r.contentType).toBe('article');
    expect(r.transcriptStatus).toBe('na');
    expect(r.extractStatus).toBe('ok');
    expect(r.contentMd).toContain('Substantive feed body');
    expect(r.rawContent).toContain('Substantive feed body');
  });

  test('null content + empty url + 403-only → null content, blocked', async () => {
    const r = await extractArticle({ url: '', rawContent: null, externalId: null });
    expect(r.rawContent).toBeNull();
    expect(r.contentMd).toBeNull();
    expect(r.extractStatus).toBe('ok'); // no url to fetch, no feed → no enhancement attempted → ok
  });
});
