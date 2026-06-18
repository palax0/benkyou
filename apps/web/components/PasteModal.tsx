'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import { PASTE_EVENT } from './shell/commands';

export function PasteModal({ aiConfigured }: { aiConfigured: boolean }) {
  const t = useTranslations('paste');
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const open = (): void => {
      setUrl('');
      setError(null);
      ref.current?.showModal();
    };
    window.addEventListener(PASTE_EVENT, open);
    return () => window.removeEventListener(PASTE_EVENT, open);
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/items/paste', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.status === 409) {
        setError(t('aiRequired'));
        return;
      }
      if (!res.ok) {
        setError(t('failed'));
        return;
      }
      const data = (await res.json()) as { created?: string; existing?: string };
      const id = data.created ?? data.existing;
      ref.current?.close();
      if (id) router.push(`/items/${id}` as Route);
    } finally {
      setPending(false);
    }
  }

  return (
    // DESIGN-GAP: modal chrome — neutral centered dialog for now.
    <dialog ref={ref} className="m-auto w-full max-w-md rounded-md bg-surface p-5 text-ink backdrop:bg-ink/25">
      <h2 className="mb-3 font-serif text-lg font-semibold">{t('title')}</h2>
      {aiConfigured ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('placeholder')}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          {error ? <p className="text-sm text-muted">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => ref.current?.close()} className="rounded-md border border-line px-3 py-1.5 text-sm">
              {t('cancel')}
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-accent-vivid px-3 py-1.5 text-sm text-bg disabled:opacity-50">
              {t('submit')}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t('aiRequired')}</p>
          <div className="flex justify-end">
            <button type="button" onClick={() => ref.current?.close()} className="rounded-md border border-line px-3 py-1.5 text-sm">
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
