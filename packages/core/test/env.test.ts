import { describe, expect, test, vi } from 'vitest';

describe('env config', () => {
  test('DEPLOY_MODE defaults to "docker" if unset', async () => {
    vi.resetModules();
    vi.stubEnv('DEPLOY_MODE', '');
    vi.stubEnv('DATABASE_URL', 'postgres://x/y');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(32));
    vi.stubEnv('EMBED_DIM', '1536');
    const { env } = await import('../src/config/env.js');
    expect(env.DEPLOY_MODE).toBe('docker');
    vi.unstubAllEnvs();
  });

  test('assertEnv() throws when SESSION_SECRET shorter than 32 chars', async () => {
    vi.resetModules();
    vi.stubEnv('DEPLOY_MODE', 'docker');
    vi.stubEnv('DATABASE_URL', 'postgres://x/y');
    vi.stubEnv('SESSION_SECRET', 'short');
    vi.stubEnv('EMBED_DIM', '1536');
    const { assertEnv } = await import('../src/config/env.js');
    expect(() => assertEnv()).toThrow(/SESSION_SECRET/);
    vi.unstubAllEnvs();
  });

  test('importing the module never throws, even with invalid env', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SESSION_SECRET', 'short');
    vi.stubEnv('EMBED_DIM', 'not-a-number');
    await expect(import('../src/config/env.js')).resolves.toBeDefined();
    vi.unstubAllEnvs();
  });

  test('EMBED_DIM coerced to number', async () => {
    vi.resetModules();
    vi.stubEnv('DEPLOY_MODE', 'docker');
    vi.stubEnv('DATABASE_URL', 'postgres://x/y');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(32));
    vi.stubEnv('EMBED_DIM', '1536');
    const { env } = await import('../src/config/env.js');
    expect(env.EMBED_DIM).toBe(1536);
    vi.unstubAllEnvs();
  });
});
