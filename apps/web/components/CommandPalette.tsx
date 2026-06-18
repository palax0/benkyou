'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import { PALETTE_EVENT, PASTE_EVENT } from './shell/commands';

export function CommandPalette() {
  const t = useTranslations('palette');
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const open = (): void => {
      setQuery('');
      ref.current?.showModal();
    };
    window.addEventListener(PALETTE_EVENT, open);
    return () => window.removeEventListener(PALETTE_EVENT, open);
  }, []);

  function close(): void {
    ref.current?.close();
  }

  type Action = { key: string; label: string; run: () => void };

  const actions: Action[] = [
    { key: 'search', label: t('search'), run: () => { close(); router.push('/search' as Route); } },
    { key: 'paste', label: t('paste'), run: () => { close(); window.dispatchEvent(new CustomEvent(PASTE_EVENT)); } },
    { key: 'feed', label: t('feed'), run: () => { close(); router.push('/' as Route); } },
    { key: 'sources', label: t('sources'), run: () => { close(); router.push('/sources' as Route); } },
    { key: 'settings', label: t('settings'), run: () => { close(); router.push('/settings' as Route); } },
  ];

  const filtered = query.trim()
    ? actions.filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase()))
    : actions;

  return (
    // DESIGN-GAP: palette chrome — neutral centered dialog for now.
    <dialog ref={ref} className="m-auto w-full max-w-sm rounded-md bg-surface p-4 text-ink backdrop:bg-ink/25">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{t('title')}</p>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('placeholder')}
        autoFocus
        className="mb-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
      />
      <ul className="flex flex-col">
        {filtered.map((action) => (
          <li key={action.key}>
            <button
              type="button"
              onClick={action.run}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-ink transition-colors duration-150 hover:bg-ink/5 motion-reduce:transition-none"
            >
              {action.label}
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
