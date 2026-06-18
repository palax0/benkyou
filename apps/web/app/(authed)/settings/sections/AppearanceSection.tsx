'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { updateAppearanceAction, type SettingsState } from '../actions';

// Theme is client-side only: sets data-theme on <html> and persists to localStorage.
// No DB column for theme (spec §9 / task brief). Locale IS persisted via updateAppearanceAction.
function ThemeControl() {
  const t = useTranslations('settings');

  function handleTheme(value: string) {
    document.documentElement.dataset['theme'] = value;
    localStorage.setItem('theme', value);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-ink">{t('theme')}</span>
      <div className="flex gap-2 text-sm">
        {(['system', 'light', 'dark'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => handleTheme(v)}
            className="rounded-full border border-line px-3 py-1 text-muted"
          >
            {v === 'system' ? t('themeSystem') : v === 'light' ? t('themeLight') : t('themeDark')}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppearanceSection({ locale }: { locale: 'zh' | 'en' }) {
  const t = useTranslations('settings');
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateAppearanceAction, {});

  return (
    <div className="flex flex-col gap-4 text-sm">
      <form action={action} className="flex flex-col gap-3">
        <select name="locale" defaultValue={locale} className="rounded-md border border-line bg-surface p-2 text-ink">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
        {state.ok ? <p className="text-xs text-accent">{t('saved')}</p> : null}
        <button type="submit" disabled={pending} className="self-start rounded-md bg-accent-vivid px-4 py-1.5 text-bg disabled:opacity-50">
          {t('save')}
        </button>
      </form>
      <ThemeControl />
    </div>
  );
}
