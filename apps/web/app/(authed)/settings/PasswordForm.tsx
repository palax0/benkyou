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
        className="rounded-md border border-line bg-surface p-2 text-ink"
      />
      {state.error ? <p className="text-sm text-err">{t('passwordTooShort')}</p> : null}
      {state.ok ? <p className="text-sm text-accent">{t('passwordChanged')}</p> : null}
      <button type="submit" disabled={pending} className="rounded-md border border-line p-2 text-ink disabled:opacity-50">
        {t('changePassword')}
      </button>
    </form>
  );
}
