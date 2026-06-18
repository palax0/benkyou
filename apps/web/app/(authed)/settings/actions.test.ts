import { beforeEach, describe, expect, test, vi } from 'vitest';
import type * as SettingsModule from '@benkyou/core/settings';

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

vi.mock('@benkyou/core/settings', async (importActual) => {
  const actual = await importActual<typeof SettingsModule>();
  return {
    ...actual,
    getUserSettings: mocks.getUserSettings,
    setPasswordHash: mocks.setPasswordHash,
    updateSettings: mocks.updateSettings,
  };
});

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

  describe('updateRankingAction custom-weights branch', () => {
    function rankingForm(entries: Record<string, string>): FormData {
      const fd = new FormData();
      for (const [k, v] of Object.entries(entries)) fd.set(k, v);
      return fd;
    }

    test('writes finite non-negative custom weights', async () => {
      const { updateRankingAction } = await import('./actions.js');
      const result = await updateRankingAction({}, rankingForm({ alpha: '0.5', beta: '0.3', gamma: '0.2' }));
      expect(result.ok).toBe(true);
      expect(mocks.updateSettings).toHaveBeenCalledWith({ weightAlpha: '0.5', weightBeta: '0.3', weightGamma: '0.2' });
    });

    test('rejects non-numeric weights without writing', async () => {
      const { updateRankingAction } = await import('./actions.js');
      const result = await updateRankingAction({}, rankingForm({ alpha: 'abc', beta: '0.3', gamma: '0.2' }));
      expect(result.error).toBe('invalidWeights');
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    test('rejects negative weights without writing', async () => {
      const { updateRankingAction } = await import('./actions.js');
      const result = await updateRankingAction({}, rankingForm({ alpha: '-1', beta: '0.3', gamma: '0.2' }));
      expect(result.error).toBe('invalidWeights');
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    test('preset branch writes the preset weights', async () => {
      const { updateRankingAction } = await import('./actions.js');
      const { RANKING_PRESETS } = await import('@benkyou/core/settings');
      const result = await updateRankingAction({}, rankingForm({ preset: 'balanced' }));
      expect(result.ok).toBe(true);
      const w = RANKING_PRESETS.balanced;
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        weightAlpha: String(w.alpha),
        weightBeta: String(w.beta),
        weightGamma: String(w.gamma),
      });
    });
  });
});
