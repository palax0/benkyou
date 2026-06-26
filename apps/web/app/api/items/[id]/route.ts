import { deleteItem } from '@benkyou/core/items';
import { requireApiAuth } from '@/lib/auth';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { id } = await params;
  const result = await deleteItem(id);
  return Response.json(result, { status: result.deleted ? 200 : 404 });
}
