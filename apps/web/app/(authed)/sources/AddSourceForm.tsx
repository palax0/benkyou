'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { addSourceAction, type SourceFormState } from './actions';

const field = 'rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800';

export function AddSourceForm() {
  const t = useTranslations('sources');
  const [state, action, pending] = useActionState<SourceFormState, FormData>(addSourceAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded border border-slate-200 p-3 dark:border-slate-700">
      <input name="name" required placeholder={t('namePlaceholder')} defaultValue={state.values?.name ?? ''} className={field} />
      <input name="url" type="url" required placeholder={t('urlPlaceholder')} defaultValue={state.values?.url ?? ''} className={field} />
      <input name="weight" type="number" step="0.1" min="0.1" placeholder={t('weightPlaceholder')} defaultValue={state.values?.weight ?? '1'} className={`${field} w-24`} />
      <button type="submit" disabled={pending} className="rounded bg-slate-900 p-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
        {t('add')}
      </button>
      {state.error ? <p className="w-full text-sm text-red-600">{t('invalid')}</p> : null}
    </form>
  );
}
