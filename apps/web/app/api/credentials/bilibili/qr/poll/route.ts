import { z } from 'zod';
import { pollBilibiliQr } from '@benkyou/core/sources';
import { requireApiAuth } from '@/lib/auth';

const schema = z.object({ key: z.string().min(1) });

export async function GET(req: Request): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const parsed = schema.safeParse({ key: new URL(req.url).searchParams.get('key') });
  if (!parsed.success) return Response.json({ error: 'missing key' }, { status: 400 });
  const result = await pollBilibiliQr(parsed.data.key); // persists SESSDATA on success
  return Response.json(result);
}
