'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { env } from '@benkyou/core/config';
import { hashPassword } from '@benkyou/core/auth';
import { getUserSettings, setPasswordHash, updateSettings, RANKING_PRESETS } from '@benkyou/core/settings';
import type { RankingPreset } from '@benkyou/core/settings';
import { testEmbedding, testLLM } from '@benkyou/core/setup';
import { requireAuth } from '@/lib/auth';

export interface FormValues {
  locale: string;
  llmProvider: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmCheapModel: string;
  embedProvider: string;
  embedBaseUrl: string;
  embedApiKey: string;
  embedModel: string;
  embedRequestDimensions: boolean;
  interestTags: string;
  readerBaseUrl: string;
  readerApiKey: string;
}

export interface SettingsState {
  ok?: boolean;
  error?: string;
  detail?: string;
  dim?: { got: number; want: number };
  values?: FormValues;
}

const Schema = z.object({
  locale: z.enum(['zh', 'en']),
  llmProvider: z.string().min(1),
  llmBaseUrl: z.string().optional(),
  llmApiKey: z.string().optional(),
  llmModel: z.string().min(1),
  llmCheapModel: z.string().optional(),
  embedProvider: z.string().min(1),
  embedBaseUrl: z.string().optional(),
  embedApiKey: z.string().optional(),
  embedModel: z.string().min(1),
  interestTags: z.string().optional(),
  readerBaseUrl: z.string().optional(),
  readerApiKey: z.string().optional(),
});

function str(fd: FormData, k: string): string | undefined {
  const v = fd.get(k);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function updateSettingsAction(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  await requireAuth();
  const values: FormValues = {
    locale: String(fd.get('locale') ?? 'zh'),
    llmProvider: String(fd.get('llmProvider') ?? ''),
    llmBaseUrl: String(fd.get('llmBaseUrl') ?? ''),
    llmApiKey: String(fd.get('llmApiKey') ?? ''),
    llmModel: String(fd.get('llmModel') ?? ''),
    llmCheapModel: String(fd.get('llmCheapModel') ?? ''),
    embedProvider: String(fd.get('embedProvider') ?? ''),
    embedBaseUrl: String(fd.get('embedBaseUrl') ?? ''),
    embedApiKey: String(fd.get('embedApiKey') ?? ''),
    embedModel: String(fd.get('embedModel') ?? ''),
    embedRequestDimensions: fd.get('embedRequestDimensions') === 'on',
    interestTags: String(fd.get('interestTags') ?? ''),
    readerBaseUrl: String(fd.get('readerBaseUrl') ?? ''),
    readerApiKey: String(fd.get('readerApiKey') ?? ''),
  };
  const parsed = Schema.safeParse({
    locale: fd.get('locale'),
    llmProvider: fd.get('llmProvider'),
    llmBaseUrl: str(fd, 'llmBaseUrl'),
    llmApiKey: str(fd, 'llmApiKey'),
    llmModel: fd.get('llmModel'),
    llmCheapModel: str(fd, 'llmCheapModel'),
    embedProvider: fd.get('embedProvider'),
    embedBaseUrl: str(fd, 'embedBaseUrl'),
    embedApiKey: str(fd, 'embedApiKey'),
    embedModel: fd.get('embedModel'),
    interestTags: str(fd, 'interestTags'),
    readerBaseUrl: str(fd, 'readerBaseUrl'),
    readerApiKey: str(fd, 'readerApiKey'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'invalid', values };
  const v = parsed.data;
  const requestDimensions = fd.get('embedRequestDimensions') === 'on';
  const current = await getUserSettings();
  if (!current) return { error: 'notInitialized', values };
  const llmApiKey = v.llmApiKey ?? current.llmApiKey;
  const embedApiKey = v.embedApiKey ?? current.embedApiKey;
  const readerApiKey = v.readerApiKey ?? current.readerApiKey;

  const llmCfg = { provider: v.llmProvider, baseUrl: v.llmBaseUrl, apiKey: llmApiKey ?? undefined, model: v.llmModel };
  const embedCfg = {
    provider: v.embedProvider,
    baseUrl: v.embedBaseUrl,
    apiKey: embedApiKey ?? undefined,
    model: v.embedModel,
    dimensions: requestDimensions ? env.EMBED_DIM : undefined,
  };

  const llmTest = await testLLM(llmCfg);
  if (!llmTest.ok) return { error: 'llmFailed', detail: llmTest.error, values };
  const embTest = await testEmbedding(embedCfg);
  if (!embTest.ok) return { error: 'embedFailed', detail: embTest.error, values };
  if (embTest.dim !== env.EMBED_DIM) {
    return { error: 'dimMismatch', dim: { got: embTest.dim ?? 0, want: env.EMBED_DIM }, values };
  }

  await updateSettings({
    locale: v.locale,
    llmProvider: v.llmProvider,
    llmBaseUrl: v.llmBaseUrl ?? null,
    llmApiKey,
    llmModel: v.llmModel,
    llmCheapModel: v.llmCheapModel ?? v.llmModel,
    embedProvider: v.embedProvider,
    embedBaseUrl: v.embedBaseUrl ?? null,
    embedApiKey,
    embedModel: v.embedModel,
    embedRequestDimensions: requestDimensions,
    interestTags: (v.interestTags ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    readerBaseUrl: v.readerBaseUrl ?? null,
    readerApiKey,
  });
  revalidatePath('/settings');
  return { ok: true };
}

export async function updateRankingAction(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  await requireAuth();
  const preset = String(fd.get('preset') ?? '');
  if (preset in RANKING_PRESETS) {
    const w = RANKING_PRESETS[preset as RankingPreset];
    await updateSettings({ weightAlpha: String(w.alpha), weightBeta: String(w.beta), weightGamma: String(w.gamma) });
  } else {
    // custom: read the three numbers (spec §5.3 advanced fold)
    const num = (k: string): string => String(Number(fd.get(k) ?? 0));
    await updateSettings({ weightAlpha: num('alpha'), weightBeta: num('beta'), weightGamma: num('gamma') });
  }
  revalidatePath('/settings');
  return { ok: true };
}

export async function updateInterestsAction(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  await requireAuth();
  const tags = String(fd.get('interestTags') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  await updateSettings({ interestTags: tags });
  revalidatePath('/settings');
  return { ok: true };
}

export async function updateAppearanceAction(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  await requireAuth();
  const locale = fd.get('locale') === 'en' ? 'en' : 'zh';
  (await cookies()).set('locale', locale, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  await updateSettings({ locale });
  revalidatePath('/settings');
  return { ok: true };
}

export async function changePasswordAction(_p: SettingsState, fd: FormData): Promise<SettingsState> {
  await requireAuth();
  const pw = String(fd.get('newPassword') ?? '');
  if (pw.length < 8) return { error: 'passwordTooShort' };
  await setPasswordHash(await hashPassword(pw));
  return { ok: true };
}
