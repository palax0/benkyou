'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { editSourceAction, type SourceFormState } from './actions';

const field = 'rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800';

export function EditSourceForm({
  id,
  defaults,
}: {
  id: string;
  defaults: { name: string; url: string; weight: string };
}) {
  const t = useTranslations('sources');
  const [state, action, pending] = useActionState<SourceFormState, FormData>(editSourceAction, {});
  const v = state.values;
  return (
    <form action={action} className="mt-1 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="name" required defaultValue={v?.name ?? defaults.name} className={field} />
      <input name="url" type="url" required defaultValue={v?.url ?? defaults.url} className={field} />
      <input name="weight" type="number" step="0.1" min="0.1" defaultValue={v?.weight ?? defaults.weight} className={`${field} w-24`} />
      <button type="submit" disabled={pending} className="rounded border border-slate-300 px-2 py-1 dark:border-slate-600">
        {t('save')}
      </button>
      {state.error ? <p className="w-full text-sm text-red-600">{t('invalid')}</p> : null}
    </form>
  );
}
