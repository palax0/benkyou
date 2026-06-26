'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';

// Lifecycle actions for the item detail page. A single `pending` flag guards
// against double-submit (spec §2/§3). On a non-2xx response we stay put — the
// item is still in the feed thanks to resetAndEnqueue's compensation (spec §2).
export function ItemActions({ itemId, state }: { itemId: string; state: string }) {
  const t = useTranslations('item');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const failed = state === 'failed';
  const canReprocess = state === 'done' || failed;

  async function run(req: () => Promise<Response>, onOk: () => void): Promise<void> {
    setPending(true);
    try {
      const res = await req();
      if (res.ok) onOk();
      // DESIGN-GAP: surface a non-2xx error toast in the impeccable pass.
    } finally {
      setPending(false);
    }
  }

  function resume(): void {
    void run(() => fetch(`/api/items/${itemId}/retry`, { method: 'POST' }), () => router.refresh());
  }
  function reprocess(): void {
    if (!window.confirm(t('actions.reprocessConfirm'))) return;
    void run(() => fetch(`/api/items/${itemId}/reprocess`, { method: 'POST' }), () => router.refresh());
  }
  function remove(): void {
    if (!window.confirm(t('actions.deleteConfirm'))) return;
    void run(() => fetch(`/api/items/${itemId}`, { method: 'DELETE' }), () => router.push('/' as Route));
  }

  return (
    // DESIGN-GAP: lifecycle action cluster — structurally-neutral buttons; impeccable polishes later.
    <div className="flex flex-wrap items-center gap-2">
      {failed ? (
        <button
          type="button"
          onClick={resume}
          disabled={pending}
          className="rounded-md bg-accent-vivid px-3 py-1.5 text-sm text-bg disabled:opacity-50"
        >
          {t('actions.resume')}
        </button>
      ) : null}
      {canReprocess ? (
        <button
          type="button"
          onClick={reprocess}
          disabled={pending}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink disabled:opacity-50"
        >
          {t('actions.reprocess')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="rounded-md border border-line px-3 py-1.5 text-sm text-err disabled:opacity-50"
      >
        {t('actions.delete')}
      </button>
    </div>
  );
}
