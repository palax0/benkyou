import { beforeEach, describe, expect, test, vi } from 'vitest';

const redirectError = new Error('NEXT_REDIRECT');

const mocks = vi.hoisted(() => ({
  isInitialized: vi.fn(),
  testLLM: vi.fn(),
  testEmbedding: vi.fn(),
  completeSetup: vi.fn(),
  addRssSource: vi.fn(),
  triggerSourceFetch: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw redirectError;
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: vi.fn(),
  })),
  headers: vi.fn(async () => ({
    get: vi.fn(),
  })),
}));

vi.mock('@benkyou/core/config', () => ({
  env: { INITIAL_PASSWORD: 'initial-password', EMBED_DIM: 1536 },
}));

vi.mock('@benkyou/core/auth', () => ({
  createSession: mocks.createSession,
}));

vi.mock('@benkyou/core/setup', () => ({
  addRssSource: mocks.addRssSource,
  completeSetup: mocks.completeSetup,
  isInitialized: mocks.isInitialized,
  testEmbedding: mocks.testEmbedding,
  testLLM: mocks.testLLM,
  triggerSourceFetch: mocks.triggerSourceFetch,
}));

describe('setupAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('redirects initialized installs before connectivity tests or session creation', async () => {
    mocks.isInitialized.mockResolvedValue(true);
    const { setupAction } = await import('./actions.js');

    await expect(setupAction({}, new FormData())).rejects.toThrow(redirectError);

    expect(mocks.testLLM).not.toHaveBeenCalled();
    expect(mocks.testEmbedding).not.toHaveBeenCalled();
    expect(mocks.completeSetup).not.toHaveBeenCalled();
    expect(mocks.addRssSource).not.toHaveBeenCalled();
    expect(mocks.triggerSourceFetch).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
