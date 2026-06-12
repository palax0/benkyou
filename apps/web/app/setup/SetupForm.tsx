'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { setupAction, type SetupState } from './actions';

const field = 'rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800';

export function SetupForm({ embedDim }: { embedDim: number }) {
  const t = useTranslations('setup');
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});

  const v = state.values;
  const errorText =
    state.error === 'dimMismatch'
      ? t('dimMismatch', { got: state.dim?.got ?? 0, want: state.dim?.want ?? 0 })
      : state.error
        ? t(state.error as 'llmFailed', { error: state.detail ?? '' })
        : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm">{t('locale')}</span>
        <select name="locale" defaultValue={v?.locale ?? 'zh'} className={field}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold">{t('llmSection')}</legend>
        <input name="llmProvider" required placeholder={t('provider')} defaultValue={v?.llmProvider ?? 'openai'} className={field} />
        <input name="llmBaseUrl" placeholder={t('baseUrl')} defaultValue={v?.llmBaseUrl ?? ''} className={field} />
        <input name="llmApiKey" type="password" defaultValue={v?.llmApiKey ?? ''} placeholder={t('apiKey')} className={field} />
        <input name="llmModel" required placeholder={t('model')} defaultValue={v?.llmModel ?? ''} className={field} />
        <input name="llmCheapModel" placeholder={t('cheapModel')} defaultValue={v?.llmCheapModel ?? ''} className={field} />
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold">{t('embedSection')}</legend>
        <input name="embedProvider" required placeholder={t('provider')} defaultValue={v?.embedProvider ?? 'openai'} className={field} />
        <input name="embedBaseUrl" placeholder={t('baseUrl')} defaultValue={v?.embedBaseUrl ?? ''} className={field} />
        <input name="embedApiKey" type="password" defaultValue={v?.embedApiKey ?? ''} placeholder={t('apiKey')} className={field} />
        <input name="embedModel" required placeholder={t('model')} defaultValue={v?.embedModel ?? ''} className={field} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="embedRequestDimensions" defaultChecked={v?.embedRequestDimensions ?? false} />
          <span>{t('requestDimensions', { dim: embedDim })}</span>
        </label>
        <p className="text-xs text-slate-500">{t('requestDimensionsHelp', { dim: embedDim })}</p>
      </fieldset>

      <input name="interestTags" placeholder={t('interests')} defaultValue={v?.interestTags ?? ''} className={field} />

      <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-semibold">{t('sourceSection')}</legend>
        <input name="sourceName" required placeholder={t('sourceName')} defaultValue={v?.sourceName ?? ''} className={field} />
        <input name="sourceUrl" type="url" required placeholder={t('sourceUrl')} defaultValue={v?.sourceUrl ?? ''} className={field} />
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
