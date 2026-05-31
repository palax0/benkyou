import { processBatch } from '@benkyou/core/queue';

// Public trigger for serverless mode (external cron pings this). Optional shared
// secret via CRON_SECRET. In docker mode the long-running worker drains instead,
// but this endpoint is harmless there too.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = url.searchParams.get('secret') ?? req.headers.get('authorization')?.replace(/^Bearer /, '');
    if (provided !== secret) return new Response('Forbidden', { status: 403 });
  }
  const maxRaw = Number(url.searchParams.get('max') ?? '20');
  const max = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.min(maxRaw, 100) : 20;
  const result = await processBatch(max);
  return Response.json(result);
}
