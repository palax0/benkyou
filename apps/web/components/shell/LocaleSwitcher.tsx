'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations('shell');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const target = locale === 'zh' ? 'en' : 'zh';

  function switchLocale(): void {
    document.cookie = `locale=${target}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={switchLocale}
      disabled={pending}
      title={t('switchLocale')}
      aria-label={t('switchLocale')}
      className="inline-flex h-8 items-center rounded-md px-2 text-sm text-muted transition-colors duration-150 hover:bg-ink/5 hover:text-ink disabled:opacity-60 motion-reduce:transition-none"
    >
      {target === 'en' ? 'EN' : '中文'}
    </button>
  );
}
