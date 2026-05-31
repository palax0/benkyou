'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import type { UserSettings } from '@benkyou/core/settings';
import { updateSettingsAction, type SettingsState } from './actions';

const field = 'rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800';

export function SettingsForm({ settings, embedDim }: { settings: UserSettings; embedDim: number }) {
  const t = useTranslations('settings');
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateSettingsAction, {});

  const errorText =
    state.error === 'dimMismatch'
      ? t('dimMismatch', { got: state.values?.got ?? 0, want: state.values?.want ?? 0 })
      : state.error
        ? t(state.error as 'llmFailed')
        : null;

  return (
    <form action={action} className="flex flex-col gap-3">
      <select name="locale" defaultValue={settings.locale} className={field}>
        <option value="zh">中文</option>
        <option value="en">English</option>
      </select>

      <input name="llmProvider" required defaultValue={settings.llmProvider ?? ''} className={field} placeholder="llm provider" />
      <input name="llmBaseUrl" defaultValue={settings.llmBaseUrl ?? ''} className={field} placeholder="llm base url" />
      <input name="llmApiKey" type="password" defaultValue={settings.llmApiKey ?? ''} className={field} placeholder="llm api key" />
      <input name="llmModel" required defaultValue={settings.llmModel ?? ''} className={field} placeholder="llm model" />
      <input name="llmCheapModel" defaultValue={settings.llmCheapModel ?? ''} className={field} placeholder="llm cheap model" />

      <input name="embedProvider" required defaultValue={settings.embedProvider ?? ''} className={field} placeholder="embed provider" />
      <input name="embedBaseUrl" defaultValue={settings.embedBaseUrl ?? ''} className={field} placeholder="embed base url" />
      <input name="embedApiKey" type="password" defaultValue={settings.embedApiKey ?? ''} className={field} placeholder="embed api key" />
      <input name="embedModel" required defaultValue={settings.embedModel ?? ''} className={field} placeholder="embed model" />

      <p className="text-xs text-slate-500">{t('embedDimNote', { dim: embedDim })}</p>

      <input
        name="interestTags"
        defaultValue={(settings.interestTags ?? []).join(', ')}
        className={field}
        placeholder="interest tags"
      />

      {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}
      {state.ok ? <p className="text-sm text-green-600">{t('saved')}</p> : null}
      <button type="submit" disabled={pending} className="rounded bg-slate-900 p-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
        {t('save')}
      </button>
    </form>
  );
}
