import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@benkyou/core/pipeline', () => ({ reprocessItem: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireApiAuth: vi.fn(async () => null) }));

import { POST } from './route';
import { reprocessItem } from '@benkyou/core/pipeline';
import { requireApiAuth } from '@/lib/auth';

const ctx = { params: Promise.resolve({ id: 'item-1' }) };
const req = new Request('http://x/api/items/item-1/reprocess', { method: 'POST' });

describe('POST /api/items/:id/reprocess', () => {
  beforeEach(() => vi.clearAllMocks());

  test('200 when requeued', async () => {
    vi.mocked(reprocessItem).mockResolvedValue({ requeued: true });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(reprocessItem)).toHaveBeenCalledWith('item-1');
  });

  test('409 when in-flight', async () => {
    vi.mocked(reprocessItem).mockResolvedValue({ requeued: false, reason: 'in-flight' });
    expect((await POST(req, ctx)).status).toBe(409);
  });

  test('404 when not found', async () => {
    vi.mocked(reprocessItem).mockResolvedValue({ requeued: false, reason: 'not-found' });
    expect((await POST(req, ctx)).status).toBe(404);
  });

  test('401 when unauthenticated', async () => {
    vi.mocked(requireApiAuth).mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    expect((await POST(req, ctx)).status).toBe(401);
  });
});
