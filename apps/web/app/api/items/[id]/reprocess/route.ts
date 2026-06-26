import { reprocessItem } from '@benkyou/core/pipeline';
import { requireApiAuth } from '@/lib/auth';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await params;
  const result = await reprocessItem(id);
  if (result.requeued) return Response.json(result, { status: 200 });
  return Response.json(result, { status: result.reason === 'not-found' ? 404 : 409 });
}
