'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { setupAction, type SetupState } from './actions';

const field = 'rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800';

export function SetupForm({ embedDim }: { embedDim: number }) {
  const t = useTranslations('setup');
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});

  const errorText =
    state.error === 'dimMismatch'
      ? t('dimMismatch', { got: state.values?.got ?? 0, want: state.values?.want ?? 0 })
      : state.error
        ? t(state.error as 'llmFailed', { error: state.detail ?? '' })
        : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm">{t('locale')}</span>
        <select name="locale" defaultValue="zh" className={field}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold">{t('llmSection')}</legend>
        <input name="llmProvider" required placeholder={t('provider')} defaultValue="openai" className={field} />
        <input name="llmBaseUrl" placeholder={t('baseUrl')} className={field} />
        <input name="llmApiKey" type="password" placeholder={t('apiKey')} className={field} />
        <input name="llmModel" required placeholder={t('model')} className={field} />
        <input name="llmCheapModel" placeholder={t('cheapModel')} className={field} />
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold">{t('embedSection')}</legend>
        <input name="embedProvider" required placeholder={t('provider')} defaultValue="openai" className={field} />
        <input name="embedBaseUrl" placeholder={t('baseUrl')} className={field} />
        <input name="embedApiKey" type="password" placeholder={t('apiKey')} className={field} />
        <input name="embedModel" required placeholder={t('model')} className={field} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="embedRequestDimensions" />
          <span>{t('requestDimensions', { dim: embedDim })}</span>
        </label>
        <p className="text-xs text-slate-500">{t('requestDimensionsHelp', { dim: embedDim })}</p>
      </fieldset>

      <input name="interestTags" placeholder={t('interests')} className={field} />

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold">{t('sourceSection')}</legend>
        <input name="sourceName" required placeholder={t('sourceName')} className={field} />
        <input name="sourceUrl" type="url" required placeholder={t('sourceUrl')} className={field} />
      </fieldset>

      {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-900 p-2 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {t('submit')}
      </button>
    </form>
  );
}
