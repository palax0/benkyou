'use client';

import { useTranslations } from 'next-intl';
import { deleteSourceAction } from './actions';

export function DeleteSourceForm({ id }: { id: string }) {
  const t = useTranslations('sources');
  return (
    <details>
      <summary className="cursor-pointer text-red-600">{t('delete')}</summary>
      <form action={deleteSourceAction} className="mt-1 flex flex-col gap-1 text-xs">
        <input type="hidden" name="id" value={id} />
        <label className="flex items-center gap-1">
          <input type="checkbox" name="cascade" /> {t('deleteWithContent')}
        </label>
        <button type="submit" className="rounded bg-red-600 px-2 py-0.5 text-white">{t('confirmDelete')}</button>
      </form>
    </details>
  );
}
