'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { setupAction, type SetupState } from './actions';

export function SetupForm() {
  const t = useTranslations('setup');
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});
  const errorText = state.error ? t(state.error as 'needInitialPassword') : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm text-ink">{t('locale')}</span>
        <select name="locale" defaultValue={state.values?.locale ?? 'zh'} className="rounded-md border border-line bg-surface p-2 text-ink">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>
      {errorText ? <p className="text-sm text-err">{errorText}</p> : null}
      <button type="submit" disabled={pending} className="rounded-md bg-accent-vivid p-2 text-bg disabled:opacity-50">
        {t('submit')}
      </button>
    </form>
  );
}
