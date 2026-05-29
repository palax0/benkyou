import { describe, expect, test } from 'vitest';

describe('/health', () => {
  test('returns 200 with status field', async () => {
    const { GET } = await import('../app/health/route.js');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db: boolean };
    expect(['ok', 'degraded']).toContain(body.status);
    expect(typeof body.db).toBe('boolean');
  });
});
