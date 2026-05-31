import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchReadable } from '../../src/pipeline/extract.js';

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
