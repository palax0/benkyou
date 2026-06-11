'use client';

import { useTranslations } from 'next-intl';
import { useFormStatus } from 'react-dom';
import { retryItemAction } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  const t = useTranslations('jobs');
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-50 dark:border-slate-600"
    >
      {t('retry')}
    </button>
  );
}

export function RetryButton({ itemId }: { itemId: string }) {
  return (
    <form action={retryItemAction}>
      <input type="hidden" name="itemId" value={itemId} />
      <Submit />
    </form>
  );
}
