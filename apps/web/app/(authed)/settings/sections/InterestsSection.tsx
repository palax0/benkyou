'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { updateInterestsAction, type SettingsState } from '../actions';

export function InterestsSection({ tags }: { tags: string[] }) {
  const t = useTranslations('settings');
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateInterestsAction, {});

  return (
    <form action={action} className="flex flex-col gap-3 text-sm">
      <input
        name="interestTags"
        defaultValue={tags.join(', ')}
        className="rounded-md border border-line bg-surface p-2 text-ink"
        placeholder={t('interestTagsPlaceholder')}
      />
      <p className="text-xs text-muted">{t('interestsHelp')}</p>
      {state.ok ? <p className="text-xs text-accent">{t('saved')}</p> : null}
      <button type="submit" disabled={pending} className="self-start rounded-md bg-accent-vivid px-4 py-1.5 text-bg disabled:opacity-50">
        {t('save')}
      </button>
    </form>
  );
}
