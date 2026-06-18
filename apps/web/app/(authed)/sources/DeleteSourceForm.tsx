'use client';

import { useTranslations } from 'next-intl';
import { deleteSourceAction } from './actions';

export function DeleteSourceForm({ id }: { id: string }) {
  const t = useTranslations('sources');
  return (
    <details>
      <summary className="cursor-pointer text-err">{t('delete')}</summary>
      <form action={deleteSourceAction} className="mt-1 flex flex-col gap-1 text-xs">
        <input type="hidden" name="id" value={id} />
        <label className="flex items-center gap-1 text-muted">
          <input type="checkbox" name="cascade" /> {t('deleteWithContent')}
        </label>
        <button type="submit" className="rounded-md border border-line px-2 py-0.5 text-err">{t('confirmDelete')}</button>
      </form>
    </details>
  );
}
