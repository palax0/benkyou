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
        className="rounded-md border border-line bg-surface p-2 text-ink"
      />
      {state.error ? <p className="text-sm text-err">{t('invalid')}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent-vivid p-2 text-bg disabled:opacity-50"
      >
        {t('submit')}
      </button>
    </form>
  );
}
