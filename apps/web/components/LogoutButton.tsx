'use client';

import { useTranslations } from 'next-intl';
import { logoutAction } from '@/app/(authed)/actions';
import { LogoutIcon } from '@/components/shell/icons';

export function LogoutButton() {
  const t = useTranslations('nav');
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        title={t('logout')}
        aria-label={t('logout')}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-ink/5 hover:text-ink motion-reduce:transition-none"
      >
        <LogoutIcon />
      </button>
    </form>
  );
}
