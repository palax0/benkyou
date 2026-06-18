import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isInitialized } from '@benkyou/core/setup';
import { getUserSettings, isAiConfigured } from '@benkyou/core/settings';
import { getValidSession } from '@/lib/auth';
import { AppShell } from '@/components/shell/AppShell';
import { ContextRail } from '@/components/shell/ContextRail';
import { PipelineHealthBanner } from '@/components/PipelineHealthBanner';

export default async function AuthedLayout({ children }: { children: ReactNode }) {
  if (!(await isInitialized())) redirect('/setup');
  if (!(await getValidSession())) redirect('/login');
  const store = await cookies();
  const settings = await getUserSettings();
  const aiConfigured = settings ? isAiConfigured(settings) : false;
  return (
    <AppShell
      initialNavCollapsed={store.get('bk_nav')?.value === 'collapsed'}
      initialRailHidden={store.get('bk_rail')?.value === 'hidden'}
      aiConfigured={aiConfigured}
      rail={<ContextRail />}
    >
      <PipelineHealthBanner />
      {children}
    </AppShell>
  );
}
