import { createServer } from 'node:http';

// Standalone mock RSS feed for the sources e2e flow. Playwright manages its
// lifecycle as a `webServer` entry; the Next server (a separate process) and the
// in-process pipeline reach it over real TCP at RSS_MOCK_PORT. Any path other
// than /health returns the same single-item feed, so the ingest adapter's fetch
// of the configured source URL succeeds offline.

const PORT = Number(process.env.RSS_MOCK_PORT ?? 4699);
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel><title>E2E Feed</title>
    <item>
      <title>E2E Pipeline Item</title>
      <link>http://localhost:${PORT}/article</link>
      <guid>e2e-1</guid>
      <pubDate>Wed, 10 Jun 2026 10:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>${'Substantive e2e body content. '.repeat(60)}</p>]]></content:encoded>
    </item>
  </channel></rss>`;

createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/health') {
    res.writeHead(200).end('ok');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/rss+xml' }).end(FEED);
}).listen(PORT, () => console.log(`[rss-mock] listening on http://localhost:${PORT}`));
