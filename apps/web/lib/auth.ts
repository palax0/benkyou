import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { validateSession } from '@benkyou/core/auth';
import { SESSION_COOKIE } from './session-cookie';

export async function getValidSession(): Promise<boolean> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return false;
  return validateSession(id);
}

export async function requireAuth(): Promise<void> {
  if (!(await getValidSession())) redirect('/login');
}

// For route handlers: returns a 401 Response to short-circuit, or null if ok.
export async function requireApiAuth(): Promise<Response | null> {
  if (!(await getValidSession())) return new Response('Unauthorized', { status: 401 });
  return null;
}
