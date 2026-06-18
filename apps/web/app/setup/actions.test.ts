import { beforeEach, describe, expect, test, vi } from 'vitest';
import { redirect } from 'next/navigation';

const redirectError = new Error('NEXT_REDIRECT');

const mocks = vi.hoisted(() => ({
  isInitialized: vi.fn(),
  completeSetup: vi.fn(),
  createSession: vi.fn(),
  cookiesSet: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw redirectError;
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: mocks.cookiesSet,
  })),
  headers: vi.fn(async () => ({
    get: vi.fn(),
  })),
}));

// INITIAL_PASSWORD is mutable so tests can toggle it
const config = { env: { INITIAL_PASSWORD: 'initial-password', EMBED_DIM: 1536 } };
vi.mock('@benkyou/core/config', () => config);

vi.mock('@benkyou/core/auth', () => ({
  createSession: mocks.createSession,
}));

vi.mock('@benkyou/core/setup', () => ({
  completeSetup: mocks.completeSetup,
  isInitialized: mocks.isInitialized,
}));

describe('setupAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.env.INITIAL_PASSWORD = 'initial-password';
  });

  test('returns needInitialPassword when INITIAL_PASSWORD is missing', async () => {
    config.env.INITIAL_PASSWORD = '';
    mocks.isInitialized.mockResolvedValue(false);
    const { setupAction } = await import('./actions.js');

    const fd = new FormData();
    fd.set('locale', 'zh');
    const result = await setupAction({}, fd);

    expect(result).toEqual({ error: 'needInitialPassword' });
    expect(mocks.completeSetup).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  test('calls completeSetup with {password, locale}, sets session cookie, and redirects to /', async () => {
    mocks.isInitialized.mockResolvedValue(false);
    mocks.completeSetup.mockResolvedValue({ inserted: true });
    mocks.createSession.mockResolvedValue({ id: 'session-id', expiresAt: new Date('2030-01-01') });

    const { setupAction } = await import('./actions.js');

    const fd = new FormData();
    fd.set('locale', 'zh');

    await expect(setupAction({}, fd)).rejects.toThrow(redirectError);

    expect(mocks.completeSetup).toHaveBeenCalledWith({
      password: 'initial-password',
      locale: 'zh',
    });
    expect(mocks.cookiesSet).toHaveBeenCalled();
    expect(vi.mocked(redirect)).toHaveBeenCalledWith('/');
  });
});
