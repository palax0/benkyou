'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { addSourceAction, type SourceFormState } from './actions';

const field = 'rounded-md border border-line bg-bg p-2 text-ink';

export function AddSourceForm() {
  const t = useTranslations('sources');
  const [state, action, pending] = useActionState<SourceFormState, FormData>(addSourceAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-surface p-3">
      <input name="name" required placeholder={t('namePlaceholder')} defaultValue={state.values?.name ?? ''} className={field} />
      <input name="url" type="url" required placeholder={t('urlPlaceholder')} defaultValue={state.values?.url ?? ''} className={field} />
      <div className="flex flex-col gap-1">
        <input name="weight" type="number" step="0.1" min="0.1" placeholder={t('weightPlaceholder')} defaultValue={state.values?.weight ?? '1'} className={`${field} w-24`} />
        <span className="text-xs text-faint">{t('weightHelp')}</span>
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t('pollIntervalLabel')}</span>
          <select name="pollInterval" defaultValue={state.values?.pollInterval ?? '1800'} className={field}>
            <option value="900">15m</option>
            <option value="1800">30m</option>
            <option value="3600">1h</option>
            <option value="21600">6h</option>
            <option value="86400">24h</option>
          </select>
        </label>
        <span className="text-xs text-faint">{t('pollIntervalHelp')}</span>
      </div>
      <button type="submit" disabled={pending} className="rounded-md bg-accent-vivid px-3 py-2 text-bg disabled:opacity-50">
        {t('add')}
      </button>
      {state.error ? <p className="w-full text-sm text-err">{t('invalid')}</p> : null}
    </form>
  );
}
