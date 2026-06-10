'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { changePasswordAction, type SettingsState } from './actions';

export function PasswordForm() {
  const t = useTranslations('settings');
  const [state, action, pending] = useActionState<SettingsState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input
        type="password"
        name="newPassword"
        required
        placeholder={t('newPassword')}
        className="rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800"
      />
      {state.error ? <p className="text-sm text-red-600">{t('passwordTooShort')}</p> : null}
      {state.ok ? <p className="text-sm text-green-600">{t('passwordChanged')}</p> : null}
      <button type="submit" disabled={pending} className="rounded border border-slate-400 p-2 disabled:opacity-50">
        {t('changePassword')}
      </button>
    </form>
  );
}
