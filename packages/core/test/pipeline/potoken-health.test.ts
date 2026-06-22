import { afterEach, describe, expect, test, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('getPotokenHealth', () => {
  test('unset env → configured false, reachable null (no ping)', async () => {
    vi.stubEnv('POTOKEN_PROVIDER_URL', '');
    const { getPotokenHealth } = await import('../../src/pipeline/status.js');
    expect(await getPotokenHealth()).toEqual({ configured: false, reachable: null });
  });

  test('configured + reachable → reachable true', async () => {
    vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://sidecar:4416');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { getPotokenHealth } = await import('../../src/pipeline/status.js');
    expect(await getPotokenHealth()).toEqual({ configured: true, reachable: true });
  });

  test('configured + dead → reachable false (clustered YT degradation surfaces; the extract-cloudflare trap)', async () => {
    vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://sidecar:4416');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const { getPotokenHealth } = await import('../../src/pipeline/status.js');
    expect(await getPotokenHealth()).toEqual({ configured: true, reachable: false });
  });
});
