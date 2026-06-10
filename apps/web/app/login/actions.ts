'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSession, verifyPassword } from '@benkyou/core/auth';
import { getUserSettings } from '@benkyou/core/settings';
import { SESSION_COOKIE } from '@/lib/session-cookie';

export interface LoginState {
  error?: boolean;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get('password') ?? '');
  const settings = await getUserSettings();
  if (!settings) redirect('/setup');

  if (!(await verifyPassword(settings.passwordHash, password))) {
    return { error: true };
  }

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
