'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { destroySession } from '@benkyou/core/auth';
import { SESSION_COOKIE } from '@/lib/session-cookie';

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (id) await destroySession(id);
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
