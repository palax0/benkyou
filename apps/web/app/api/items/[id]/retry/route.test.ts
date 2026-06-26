import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@benkyou/core/pipeline', () => ({ retryItem: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireApiAuth: vi.fn(async () => null) }));

import { POST } from './route';
import { retryItem } from '@benkyou/core/pipeline';
import { requireApiAuth } from '@/lib/auth';

const ctx = { params: Promise.resolve({ id: 'item-1' }) };
const req = new Request('http://x/api/items/item-1/retry', { method: 'POST' });

describe('POST /api/items/:id/retry', () => {
  beforeEach(() => vi.clearAllMocks());

  test('200 when requeued', async () => {
    vi.mocked(retryItem).mockResolvedValue({ requeued: true });
    expect((await POST(req, ctx)).status).toBe(200);
  });

  test('409 when not requeued', async () => {
    vi.mocked(retryItem).mockResolvedValue({ requeued: false, reason: 'not-retryable' });
    expect((await POST(req, ctx)).status).toBe(409);
  });

  test('401 when unauthenticated', async () => {
    vi.mocked(requireApiAuth).mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    expect((await POST(req, ctx)).status).toBe(401);
  });
});
