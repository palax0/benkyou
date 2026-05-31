'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { loginAction, type LoginState } from './actions';

export function LoginForm() {
  const t = useTranslations('login');
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input
        type="password"
        name="password"
        required
        autoFocus
        placeholder={t('password')}
        className="rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800"
      />
      {state.error ? <p className="text-sm text-red-600">{t('invalid')}</p> : null}
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
