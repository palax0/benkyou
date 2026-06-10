'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { env } from '@benkyou/core/config';
import { createSession } from '@benkyou/core/auth';
import {
  addRssSource,
  completeSetup,
  isInitialized,
  testEmbedding,
  testLLM,
  triggerSourceFetch,
} from '@benkyou/core/setup';
import { SESSION_COOKIE } from '@/lib/session-cookie';

export interface SetupFormValues {
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
  sourceName: string;
  sourceUrl: string;
}

export interface SetupState {
  error?: string;
  detail?: string;
  dim?: { got: number; want: number };
  values?: SetupFormValues;
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
  sourceName: z.string().min(1),
  sourceUrl: z.string().url(),
});

function str(fd: FormData, k: string): string | undefined {
  const v = fd.get(k);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function setupAction(_prev: SetupState, fd: FormData): Promise<SetupState> {
  if (!env.INITIAL_PASSWORD) return { error: 'needInitialPassword' };
  if (await isInitialized()) redirect('/login');

  const values: SetupFormValues = {
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
    sourceName: String(fd.get('sourceName') ?? ''),
    sourceUrl: String(fd.get('sourceUrl') ?? ''),
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
    sourceName: fd.get('sourceName'),
    sourceUrl: fd.get('sourceUrl'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'invalid', values };
  const v = parsed.data;
  const requestDimensions = fd.get('embedRequestDimensions') === 'on';

  const llmCfg = { provider: v.llmProvider, baseUrl: v.llmBaseUrl, apiKey: v.llmApiKey, model: v.llmModel };
  const embedCfg = {
    provider: v.embedProvider,
    baseUrl: v.embedBaseUrl,
    apiKey: v.embedApiKey,
    model: v.embedModel,
    dimensions: requestDimensions ? env.EMBED_DIM : undefined,
  };

  // Onboarding forces connectivity tests (spec §14.1: misconfig is the #1 risk).
  const llmTest = await testLLM(llmCfg);
  if (!llmTest.ok) return { error: 'llmFailed', detail: llmTest.error, values };
  const embTest = await testEmbedding(embedCfg);
  if (!embTest.ok) return { error: 'embedFailed', detail: embTest.error, values };
  if (embTest.dim !== env.EMBED_DIM) {
    return { error: 'dimMismatch', dim: { got: embTest.dim ?? 0, want: env.EMBED_DIM }, values };
  }

  const setup = await completeSetup({
    password: env.INITIAL_PASSWORD,
    locale: v.locale,
    llm: { ...llmCfg, cheapModel: v.llmCheapModel },
    embedding: { ...embedCfg, requestDimensions },
    interestTags: (v.interestTags ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  });
  if (!setup.inserted) redirect('/login');
  const sourceId = await addRssSource(v.sourceName, v.sourceUrl);
  await triggerSourceFetch(sourceId);

  const h = await headers();
  const { id, expiresAt } = await createSession({
    ip: h.get('x-forwarded-for') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  });
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
  redirect('/');
}
