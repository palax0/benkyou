import { confirmTranscribe } from '@benkyou/core/items';
import { requireApiAuth } from '@/lib/auth';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await params;
  const result = await confirmTranscribe(id);
  return Response.json(result);
}
