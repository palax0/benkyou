'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { OnboardingState } from '@benkyou/core/onboarding';

const KEY = 'bk_onboarding_dismissed';

export function OnboardingChecklist({ state }: { state: OnboardingState }) {
  const t = useTranslations('onboarding');
  const allDone = state.aiConfigured && (state.hasSource || state.hasItem) && state.hasDone;
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid SSR flash
  useEffect(() => {
    setDismissed(localStorage.getItem(KEY) === '1');
  }, []);

  // Re-appears until truly complete (spec §4.3): dismissal is per-visit, not permanent.
  if (allDone || dismissed) return null;

  const steps = [
    { key: 'step1', href: '/settings', done: state.aiConfigured },
    { key: 'step2', href: '/sources', done: state.hasSource || state.hasItem },
    { key: 'step3', href: '/sources', done: state.hasDone },
  ] as const;

  return (
    // DESIGN-GAP: onboarding card chrome — neutral surface-2 panel for now.
    <aside className="mb-6 flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-ink">{t('title')}</h2>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(KEY, '1');
            setDismissed(true);
          }}
          className="text-xs text-muted hover:text-ink"
        >
          {t('dismiss')}
        </button>
      </div>
      <ol className="flex flex-col gap-2 text-sm">
        {steps.map(({ key, href, done }, i) => (
          <li key={key} className="flex items-center gap-2">
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${done ? 'bg-accent' : 'bg-faint'}`} />
            {done ? (
              <span className="text-muted">{t('done')} {t(key)}</span>
            ) : (
              <Link href={href} className="text-accent hover:underline">
                {i + 1}. {t(key)}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
