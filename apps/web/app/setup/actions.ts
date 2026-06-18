'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { env } from '@benkyou/core/config';
import { createSession } from '@benkyou/core/auth';
import { completeSetup, isInitialized } from '@benkyou/core/setup';
import { SESSION_COOKIE } from '@/lib/session-cookie';

export interface SetupState {
  error?: string;
  values?: { locale: string };
}

const Schema = z.object({ locale: z.enum(['zh', 'en']) });

export async function setupAction(_prev: SetupState, fd: FormData): Promise<SetupState> {
  if (!env.INITIAL_PASSWORD) return { error: 'needInitialPassword' };
  if (await isInitialized()) redirect('/login');

  const parsed = Schema.safeParse({ locale: fd.get('locale') });
  if (!parsed.success) return { error: 'invalid', values: { locale: String(fd.get('locale') ?? 'zh') } };

  const setup = await completeSetup({ password: env.INITIAL_PASSWORD, locale: parsed.data.locale });
  if (!setup.inserted) redirect('/login');

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
  redirect('/'); // lands in app shell + onboarding (spec §4.1)
}
