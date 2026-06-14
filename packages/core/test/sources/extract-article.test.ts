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
  test('extracts main article text, dropping nav/footer', async () => {
    const text = await fetchReadable('https://site.test/article');
    expect(text).toContain('first substantive paragraph');
    expect(text).not.toContain('menu junk');
    expect(text).not.toContain('footer junk');
  });

  test('returns null on HTTP error (degrade, do not throw)', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 500 })));
    expect(await fetchReadable('https://site.test/article')).toBeNull();
  });
});

describe('resolveContent', () => {
  // ~190 chars of text padded with markup well past 600 raw chars: the
  // threshold must judge text length, not HTML length.
  const BLURB_HTML =
    '<p class="excerpt" style="margin:0;padding:0;font-family:Georgia,serif;line-height:1.6">' +
    'A short feed excerpt that teases the article without giving the body. '.repeat(2) +
    '</p>' +
    `<p><a href="https://site.test/article?utm_source=rss&utm_medium=feed&utm_campaign=excerpt-tracking-${'x'.repeat(260)}">Read more</a></p>`;

  test('HTML-inflated blurb still triggers full-text fetch', async () => {
    expect(BLURB_HTML.length).toBeGreaterThan(600);
    const content = await resolveContent(BLURB_HTML, 'https://site.test/article');
    expect(content).toContain('first substantive paragraph');
    expect(content).not.toContain('Read more');
  });

  test('full-text feed content is used as-is (stripped), no fetch', async () => {
    const fullHtml = `<p>${'Substantive feed-provided article body sentence. '.repeat(20)}</p>`;
    // No handler registered for this URL: an attempted fetch would hit
    // onUnhandledRequest:'error' and degrade — the assertion below catches both.
    const content = await resolveContent(fullHtml, 'https://site.test/never-fetched');
    expect(content).toContain('Substantive feed-provided article body');
    expect(content).not.toContain('<p>');
  });

  test('keeps the blurb when fetch fails', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 403 })));
    const content = await resolveContent(BLURB_HTML, 'https://site.test/article');
    expect(content).toContain('A short feed excerpt');
    expect(content).not.toContain('<p');
  });

  test('no content and no usable fetch yields empty string', async () => {
    expect(await resolveContent(null, null)).toBe('');
  });
});

describe('extractArticle', () => {
  test('returns article contentType + transcriptStatus na', async () => {
    const fullHtml = `<p>${'Substantive feed body sentence. '.repeat(20)}</p>`;
    const r = await extractArticle({
      url: 'https://site.test/never-fetched',
      rawContent: fullHtml,
      externalId: null,
    });
    expect(r.contentType).toBe('article');
    expect(r.transcriptStatus).toBe('na');
    expect(r.rawContent).toContain('Substantive feed body');
  });

  test('null content + null url yields rawContent null (continue)', async () => {
    const r = await extractArticle({ url: '', rawContent: null, externalId: null });
    expect(r.rawContent).toBeNull();
  });
});
