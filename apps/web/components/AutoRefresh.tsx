'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const t = useTranslations('jobs');
  const [paused, setPaused] = useState(false);
  const [last, setLast] = useState<Date | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const tick = (): void => {
      // Only refresh when the tab is visible (spec §6.1). On transient failure the
      // refresh simply no-ops this cycle; session expiry redirects via (authed).
      if (pausedRef.current || document.visibilityState !== 'visible') return;
      router.refresh();
      setLast(new Date());
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-600"
      >
        {paused ? t('resume') : t('pause')}
      </button>
      <span>{last ? t('lastRefresh', { time: last.toLocaleTimeString() }) : t('autoRefresh')}</span>
    </div>
  );
}
