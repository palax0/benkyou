import { beforeEach, describe, expect, test, vi } from 'vitest';

const redirectError = new Error('NEXT_REDIRECT');
const currentSettings = {
  llmApiKey: 'stored-llm-key',
  embedApiKey: 'stored-embed-key',
};

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  updateSettings: vi.fn(),
  setPasswordHash: vi.fn(),
  hashPassword: vi.fn(async () => 'hashed-new-password'),
  testLLM: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  testEmbedding: vi.fn(async () => ({ ok: true, dim: 1536 })),
  getUserSettings: vi.fn(async () => currentSettings),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw redirectError;
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@benkyou/core/config', () => ({
  env: { EMBED_DIM: 1536 },
}));

vi.mock('@benkyou/core/auth', () => ({
  hashPassword: mocks.hashPassword,
}));

vi.mock('@benkyou/core/settings', () => ({
  getUserSettings: mocks.getUserSettings,
  setPasswordHash: mocks.setPasswordHash,
  updateSettings: mocks.updateSettings,
}));

vi.mock('@benkyou/core/setup', () => ({
  testEmbedding: mocks.testEmbedding,
  testLLM: mocks.testLLM,
}));

function settingsForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('locale', 'en');
  fd.set('llmProvider', 'openai');
  fd.set('llmModel', 'gpt-4.1');
  fd.set('embedProvider', 'openai');
  fd.set('embedModel', 'text-embedding-3-small');
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe('settings server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(undefined);
    mocks.getUserSettings.mockResolvedValue(currentSettings);
  });

  test('updateSettingsAction requires a valid server-side session', async () => {
    mocks.requireAuth.mockImplementation(async () => {
      throw redirectError;
    });
    const { updateSettingsAction } = await import('./actions.js');

    await expect(updateSettingsAction({}, settingsForm())).rejects.toThrow(redirectError);

    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  test('changePasswordAction requires a valid server-side session', async () => {
    mocks.requireAuth.mockImplementation(async () => {
      throw redirectError;
    });
    const { changePasswordAction } = await import('./actions.js');
    const fd = new FormData();
    fd.set('newPassword', 'new-password');

    await expect(changePasswordAction({}, fd)).rejects.toThrow(redirectError);

    expect(mocks.setPasswordHash).not.toHaveBeenCalled();
  });

  test('an invalid submit returns entered values for repopulation', async () => {
    mocks.testLLM.mockResolvedValueOnce({ ok: false, error: 'nope' });
    const { updateSettingsAction } = await import('./actions.js');
    const fd = settingsForm({ llmModel: 'my-model', embedModel: 'my-embed', llmApiKey: 'typed-key' });
    const result = await updateSettingsAction({}, fd);
    expect(result.error).toBe('llmFailed');
    expect(result.values).toMatchObject({
      llmProvider: 'openai',
      llmModel: 'my-model',
      embedModel: 'my-embed',
      llmApiKey: 'typed-key',
    });
  });

  test('blank API key fields preserve stored keys server-side', async () => {
    const { updateSettingsAction } = await import('./actions.js');

    await updateSettingsAction({}, settingsForm());

    expect(mocks.testLLM).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'stored-llm-key' }));
    expect(mocks.testEmbedding).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'stored-embed-key' }));
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        llmApiKey: 'stored-llm-key',
        embedApiKey: 'stored-embed-key',
      }),
    );
  });
});
