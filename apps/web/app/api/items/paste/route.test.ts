import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('@benkyou/core/settings', () => ({
  getUserSettings: vi.fn(),
  isAiConfigured: (s: { llmProvider?: string }) => Boolean(s?.llmProvider),
}));
vi.mock('@benkyou/core/items', () => ({ pasteUrl: vi.fn(async () => ({ created: 'id-1' })) }));
vi.mock('@/lib/auth', () => ({ requireApiAuth: vi.fn(async () => null) }));

import { POST } from './route';
import { getUserSettings } from '@benkyou/core/settings';
import { pasteUrl } from '@benkyou/core/items';

describe('POST /api/items/paste readiness gate', () => {
  beforeEach(() => vi.clearAllMocks());

  test('returns 409 ai_not_configured when AI unconfigured', async () => {
    vi.mocked(getUserSettings).mockResolvedValue({ llmProvider: null } as never);
    const res = await POST(new Request('http://x/api/items/paste', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://e.com' }),
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'ai_not_configured' });
  });

  test('proceeds when AI configured', async () => {
    vi.mocked(getUserSettings).mockResolvedValue({ llmProvider: 'openai' } as never);
    const res = await POST(new Request('http://x/api/items/paste', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://e.com' }),
    }));
    expect(res.status).toBe(200);
    expect(vi.mocked(pasteUrl)).toHaveBeenCalledWith('https://e.com');
  });
});
