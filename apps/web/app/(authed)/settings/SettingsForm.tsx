'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import type { UserSettings } from '@benkyou/core/settings';
import { updateSettingsAction, type SettingsState } from './actions';

const field = 'rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800';

export type SettingsFormSettings = Omit<UserSettings, 'llmApiKey' | 'embedApiKey'> & {
  llmApiKeyConfigured: boolean;
  embedApiKeyConfigured: boolean;
};

export function SettingsForm({ settings, embedDim }: { settings: SettingsFormSettings; embedDim: number }) {
  const t = useTranslations('settings');
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateSettingsAction, {});

  const errorText =
    state.error === 'dimMismatch'
      ? t('dimMismatch', { got: state.values?.got ?? 0, want: state.values?.want ?? 0 })
      : state.error
        ? t(state.error as 'llmFailed', { error: state.detail ?? '' })
        : null;

  return (
    <form action={action} className="flex flex-col gap-3">
      <select name="locale" defaultValue={settings.locale} className={field}>
        <option value="zh">中文</option>
        <option value="en">English</option>
      </select>

      <input name="llmProvider" required defaultValue={settings.llmProvider ?? ''} className={field} placeholder={t('llmProviderPlaceholder')} />
      <input name="llmBaseUrl" defaultValue={settings.llmBaseUrl ?? ''} className={field} placeholder={t('llmBaseUrlPlaceholder')} />
      <input
        name="llmApiKey"
        type="password"
        className={field}
        placeholder={settings.llmApiKeyConfigured ? t('llmApiKeyConfigured') : t('llmApiKeyPlaceholder')}
      />
      <input name="llmModel" required defaultValue={settings.llmModel ?? ''} className={field} placeholder={t('llmModelPlaceholder')} />
      <input name="llmCheapModel" defaultValue={settings.llmCheapModel ?? ''} className={field} placeholder={t('llmCheapModelPlaceholder')} />

      <input name="embedProvider" required defaultValue={settings.embedProvider ?? ''} className={field} placeholder={t('embedProviderPlaceholder')} />
      <input name="embedBaseUrl" defaultValue={settings.embedBaseUrl ?? ''} className={field} placeholder={t('embedBaseUrlPlaceholder')} />
      <input
        name="embedApiKey"
        type="password"
        className={field}
        placeholder={settings.embedApiKeyConfigured ? t('embedApiKeyConfigured') : t('embedApiKeyPlaceholder')}
      />
      <input name="embedModel" required defaultValue={settings.embedModel ?? ''} className={field} placeholder={t('embedModelPlaceholder')} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="embedRequestDimensions" defaultChecked={settings.embedRequestDimensions} />
        <span>{t('requestDimensions', { dim: embedDim })}</span>
      </label>
      <p className="text-xs text-slate-500">{t('requestDimensionsHelp', { dim: embedDim })}</p>

      <p className="text-xs text-slate-500">{t('embedDimNote', { dim: embedDim })}</p>

      <input
        name="interestTags"
        defaultValue={(settings.interestTags ?? []).join(', ')}
        className={field}
        placeholder={t('interestTagsPlaceholder')}
      />

      {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}
      {state.ok ? <p className="text-sm text-green-600">{t('saved')}</p> : null}
      <button type="submit" disabled={pending} className="rounded bg-slate-900 p-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
        {t('save')}
      </button>
    </form>
  );
}
