import { createServer, type IncomingMessage } from 'node:http';

// Standalone OpenAI-compatible mock provider for the e2e settings smoke.
// Playwright manages its lifecycle as a `webServer` entry. The Next server
// (a separate process) reaches it over real TCP at PROVIDER_MOCK_PORT, which
// is why an in-process interceptor (MSW) wouldn't work for a server-side call.
//
// It simulates a high-native-dim MRL embedding model: an /embeddings request
// returns exactly `body.dimensions` dims when asked (the "request output
// dimensions" toggle is on), otherwise its native 3072 (toggle off) — so the
// settings connectivity test reproduces both the dim-mismatch and the
// truncated-success paths end to end.

const PORT = Number(process.env.PROVIDER_MOCK_PORT ?? 4599);
const NATIVE_DIM = 3072;

interface EmbeddingRequestBody {
  input?: unknown;
  dimensions?: unknown;
  model?: unknown;
}

function buildEmbeddingResponse(body: EmbeddingRequestBody) {
  const dim = typeof body.dimensions === 'number' ? body.dimensions : NATIVE_DIM;
  // One embedding per input element — the embed pipeline stage sends two values
  // (docText + title) via embedMany and throws if the counts don't match.
  const count = Array.isArray(body.input) ? body.input.length : 1;
  return {
    object: 'list',
    data: Array.from({ length: count }, (_, index) => ({
      object: 'embedding',
      index,
      embedding: Array.from({ length: dim }, () => 0.01),
    })),
    model: typeof body.model === 'string' ? body.model : 'mock-embed',
    usage: { prompt_tokens: count, total_tokens: count },
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const server = createServer((req, res) => {
  const url = req.url ?? '';
  const path = url.split('?')[0] ?? '';

  if (req.method === 'GET' && path.endsWith('/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }

  void readJson(req).then((body) => {
    res.setHeader('content-type', 'application/json');

    if (path.endsWith('/embeddings')) {
      res.writeHead(200);
      res.end(JSON.stringify(buildEmbeddingResponse(body)));
      return;
    }

    if (path.endsWith('/chat/completions')) {
      // A structured request (`response_format` present, used by generateObject in
      // the score stage) must return JSON content matching scoreSchema; a plain
      // request returns free text.
      const structured = body.response_format != null;
      const content = structured
        ? JSON.stringify({ topic_tags: ['e2e'], topic_score: 0.5, category: 'news' })
        : 'ok';
      res.writeHead(200);
      res.end(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: typeof body.model === 'string' ? body.model : 'mock-llm',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: `unhandled mock path: ${path}` }));
  });
});

server.listen(PORT, () => {
  // Startup signal for the Playwright webServer readiness probe.
  console.log(`[provider-mock] listening on http://localhost:${PORT}`);
});
