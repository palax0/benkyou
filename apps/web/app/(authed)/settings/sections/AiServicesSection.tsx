'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import type { UserSettings } from '@benkyou/core/settings';
import { updateSettingsAction, type SettingsState } from '../actions';

const field = 'rounded-md border border-line bg-surface p-2 text-ink';

export type AiServicesSectionSettings = Omit<UserSettings, 'llmApiKey' | 'embedApiKey' | 'readerApiKey'> & {
  llmApiKeyConfigured: boolean;
  embedApiKeyConfigured: boolean;
  readerApiKeyConfigured: boolean;
};

export function AiServicesSection({
  settings,
  embedDim,
}: {
  settings: AiServicesSectionSettings;
  embedDim: number;
}) {
  const t = useTranslations('settings');
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateSettingsAction, {});

  const v = state.values;
  const errorText =
    state.error === 'dimMismatch'
      ? t('dimMismatch', { got: state.dim?.got ?? 0, want: state.dim?.want ?? 0 })
      : state.error
        ? t(state.error as 'llmFailed', { error: state.detail ?? '' })
        : null;

  return (
    <form action={action} className="flex flex-col gap-3">
      {/* Hidden fields to prevent clobber: updateSettingsAction requires locale and reads interestTags.
          Without these, locale validation fails (z.enum required) and interestTags gets wiped to []. */}
      <input type="hidden" name="locale" value={settings.locale ?? 'zh'} />
      <input
        type="hidden"
        name="interestTags"
        value={(settings.interestTags ?? []).join(', ')}
      />

      <input name="llmProvider" required defaultValue={v?.llmProvider ?? settings.llmProvider ?? ''} className={field} placeholder={t('llmProviderPlaceholder')} />
      <input name="llmBaseUrl" defaultValue={v?.llmBaseUrl ?? settings.llmBaseUrl ?? ''} className={field} placeholder={t('llmBaseUrlPlaceholder')} />
      <input
        name="llmApiKey"
        type="password"
        defaultValue={v?.llmApiKey ?? ''}
        className={field}
        placeholder={settings.llmApiKeyConfigured ? t('llmApiKeyConfigured') : t('llmApiKeyPlaceholder')}
      />
      <input name="llmModel" required defaultValue={v?.llmModel ?? settings.llmModel ?? ''} className={field} placeholder={t('llmModelPlaceholder')} />
      <input name="llmCheapModel" defaultValue={v?.llmCheapModel ?? settings.llmCheapModel ?? ''} className={field} placeholder={t('llmCheapModelPlaceholder')} />

      <input name="embedProvider" required defaultValue={v?.embedProvider ?? settings.embedProvider ?? ''} className={field} placeholder={t('embedProviderPlaceholder')} />
      <input name="embedBaseUrl" defaultValue={v?.embedBaseUrl ?? settings.embedBaseUrl ?? ''} className={field} placeholder={t('embedBaseUrlPlaceholder')} />
      <input
        name="embedApiKey"
        type="password"
        defaultValue={v?.embedApiKey ?? ''}
        className={field}
        placeholder={settings.embedApiKeyConfigured ? t('embedApiKeyConfigured') : t('embedApiKeyPlaceholder')}
      />
      <input name="embedModel" required defaultValue={v?.embedModel ?? settings.embedModel ?? ''} className={field} placeholder={t('embedModelPlaceholder')} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="embedRequestDimensions" defaultChecked={v?.embedRequestDimensions ?? settings.embedRequestDimensions} />
        <span>{t('requestDimensions', { dim: embedDim })}</span>
      </label>
      <p className="text-xs text-muted">{t('requestDimensionsHelp', { dim: embedDim })}</p>

      {/* embed_dim is read-only — frozen at install time (spec §5.3) */}
      <p className="text-xs text-faint">{t('embedDimNote', { dim: embedDim })}</p>

      <h3 className="font-semibold text-ink">{t('readerSection')}</h3>
      <input
        name="readerBaseUrl"
        defaultValue={v?.readerBaseUrl ?? settings.readerBaseUrl ?? ''}
        className={field}
        placeholder={t('readerBaseUrlPlaceholder')}
      />
      <input
        name="readerApiKey"
        type="password"
        defaultValue={v?.readerApiKey ?? ''}
        className={field}
        placeholder={settings.readerApiKeyConfigured ? t('readerApiKeyConfigured') : t('readerApiKeyPlaceholder')}
      />

      {errorText ? <p className="text-sm text-err">{errorText}</p> : null}
      {state.ok ? <p className="text-sm text-accent">{t('saved')}</p> : null}
      <button type="submit" disabled={pending} className="self-start rounded-md bg-accent-vivid px-4 py-1.5 text-bg disabled:opacity-50">
        {t('save')}
      </button>
    </form>
  );
}
