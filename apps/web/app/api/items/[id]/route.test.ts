import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@benkyou/core/items', () => ({ deleteItem: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireApiAuth: vi.fn(async () => null) }));

import { DELETE } from './route';
import { deleteItem } from '@benkyou/core/items';
import { requireApiAuth } from '@/lib/auth';

const ctx = { params: Promise.resolve({ id: 'item-1' }) };
const req = new Request('http://x/api/items/item-1', { method: 'DELETE' });

describe('DELETE /api/items/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  test('200 when deleted', async () => {
    vi.mocked(deleteItem).mockResolvedValue({ deleted: true });
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(deleteItem)).toHaveBeenCalledWith('item-1');
  });

  test('404 when nothing deleted', async () => {
    vi.mocked(deleteItem).mockResolvedValue({ deleted: false });
    expect((await DELETE(req, ctx)).status).toBe(404);
  });

  test('401 when unauthenticated', async () => {
    vi.mocked(requireApiAuth).mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    expect((await DELETE(req, ctx)).status).toBe(401);
  });
});
