'use client';

import { useTranslations } from 'next-intl';
import { updateAdhocWeightAction } from './actions';

export function AdhocWeightForm({ defaultWeight }: { defaultWeight: string }) {
  const t = useTranslations('sources');
  return (
    <form action={updateAdhocWeightAction} className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-sm text-ink">
        <span>{t('adhocWeightLabel')}</span>
        <input
          name="adhocSourceWeight"
          type="number"
          step="0.1"
          min="0"
          defaultValue={defaultWeight}
          className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
        />
        <button type="submit" className="rounded-md border border-line px-2 py-1 text-sm text-ink">
          {t('save')}
        </button>
      </label>
      <p className="text-xs text-muted">{t('adhocWeightHelp')}</p>
    </form>
  );
}
