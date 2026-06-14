import { z } from 'zod';
import { pasteUrl } from '@benkyou/core/items';
import { requireApiAuth } from '@/lib/auth';

const schema = z.object({ url: z.string().url() });

export async function POST(req: Request): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'invalid url' }, { status: 400 });
  }

  const result = await pasteUrl(parsed.data.url);
  return Response.json(result);
}
