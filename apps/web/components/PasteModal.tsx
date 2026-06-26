'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import { describeItemStatus } from '@benkyou/core/items/pipeline-view';
import { PASTE_EVENT } from './shell/commands';

type Existing = {
  id: string;
  state: string;
  currentStage: string | null;
  transcriptStatus: string;
  title: string;
};
type PasteResponse = { created?: string; existing?: Existing };

export function PasteModal({ aiConfigured }: { aiConfigured: boolean }) {
  const t = useTranslations('paste');
  const tp = useTranslations('pipeline');
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [existing, setExisting] = useState<Existing | null>(null);

  useEffect(() => {
    const open = (): void => {
      setUrl('');
      setError(null);
      setExisting(null);
      ref.current?.showModal();
    };
    window.addEventListener(PASTE_EVENT, open);
    return () => window.removeEventListener(PASTE_EVENT, open);
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setExisting(null);
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
      const data = (await res.json()) as PasteResponse;
      if (data.created) {
        ref.current?.close();
        router.push(`/items/${data.created}` as Route);
      } else if (data.existing) {
        setExisting(data.existing); // surface status instead of navigating (spec §4)
      }
    } finally {
      setPending(false);
    }
  }

  function statusLabel(e: Existing): string {
    const desc = describeItemStatus(e.state, e.currentStage, e.transcriptStatus);
    if (desc.key === 'failed') {
      return t('status.failed', { step: tp(desc.stepKey ?? 'extract') });
    }
    if (desc.key === 'doneNoTranscript') return t('status.doneNoTranscript');
    if (desc.key === 'inFlight') return t('status.inFlight');
    return t('status.done');
  }

  function view(id: string): void {
    ref.current?.close();
    router.push(`/items/${id}` as Route);
  }

  async function reprocess(id: string): Promise<void> {
    setPending(true);
    try {
      const res = await fetch(`/api/items/${id}/reprocess`, { method: 'POST' });
      if (res.ok) {
        ref.current?.close();
        router.push(`/items/${id}` as Route);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    // DESIGN-GAP: modal chrome — neutral centered dialog for now.
    <dialog ref={ref} className="m-auto w-full max-w-md rounded-md bg-surface p-5 text-ink backdrop:bg-ink/25">
      <h2 className="mb-3 font-serif text-lg font-semibold">{t('title')}</h2>
      {!aiConfigured ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t('aiRequired')}</p>
          <div className="flex justify-end">
            <button type="button" onClick={() => ref.current?.close()} className="rounded-md border border-line px-3 py-1.5 text-sm">
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : existing ? (
        // DESIGN-GAP: already-imported panel — structurally-neutral; impeccable polishes later.
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium text-ink">{t('alreadyImported')}</p>
            <p className="mt-1 text-sm text-muted">
              {existing.title} · {statusLabel(existing)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => view(existing.id)} className="rounded-md border border-line px-3 py-1.5 text-sm">
              {t('view')}
            </button>
            {existing.state === 'done' || existing.state === 'failed' ? (
              <>
                <button
                  type="button"
                  onClick={() => void reprocess(existing.id)}
                  disabled={pending}
                  className="rounded-md bg-accent-vivid px-3 py-1.5 text-sm text-bg disabled:opacity-50"
                >
                  {t('reprocess')}
                </button>
                <span className="text-xs text-faint">· {t('reprocessCost')}</span>
              </>
            ) : null}
          </div>
        </div>
      ) : (
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
      )}
    </dialog>
  );
}
