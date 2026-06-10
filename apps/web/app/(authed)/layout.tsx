import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isInitialized } from '@benkyou/core/setup';
import { getValidSession } from '@/lib/auth';
import { LogoutButton } from '@/components/LogoutButton';

export default async function AuthedLayout({ children }: { children: ReactNode }) {
  if (!(await isInitialized())) redirect('/setup');
  if (!(await getValidSession())) redirect('/login');
  const t = await getTranslations('nav');
  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-6 flex items-center gap-4 border-b border-slate-200 pb-3 dark:border-slate-700">
        <Link href="/" className="font-bold">Benkyou</Link>
        <nav className="flex gap-3 text-sm">
          <Link href="/">{t('feed')}</Link>
          <Link href="/search">{t('search')}</Link>
          <Link href="/settings">{t('settings')}</Link>
        </nav>
        <div className="ml-auto">
          <LogoutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
