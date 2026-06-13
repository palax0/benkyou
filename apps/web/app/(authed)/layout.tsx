import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isInitialized } from '@benkyou/core/setup';
import { getValidSession } from '@/lib/auth';
import { AppShell } from '@/components/shell/AppShell';
import { ContextRail } from '@/components/shell/ContextRail';

export default async function AuthedLayout({ children }: { children: ReactNode }) {
  if (!(await isInitialized())) redirect('/setup');
  if (!(await getValidSession())) redirect('/login');
  const store = await cookies();
  return (
    <AppShell
      initialNavCollapsed={store.get('bk_nav')?.value === 'collapsed'}
      initialRailHidden={store.get('bk_rail')?.value === 'hidden'}
      rail={<ContextRail />}
    >
      {children}
    </AppShell>
  );
}
