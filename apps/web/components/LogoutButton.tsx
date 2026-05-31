'use client';

import { useTranslations } from 'next-intl';
import { logoutAction } from '@/app/(authed)/actions';

export function LogoutButton() {
  const t = useTranslations('nav');
  return (
    <form action={logoutAction}>
      <button type="submit" className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
        {t('logout')}
      </button>
    </form>
  );
}
