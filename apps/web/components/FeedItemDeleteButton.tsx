'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

// Feed-row delete. router.refresh() re-renders the (state='done'-filtered) feed
// without the deleted row. DESIGN-GAP: pre-refresh optimistic hiding + styled
// confirm are deferred to the impeccable pass.
export function FeedItemDeleteButton({ itemId }: { itemId: string }) {
  const t = useTranslations('feed');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove(): Promise<void> {
    if (!window.confirm(t('deleteConfirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${itemId}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    // DESIGN-GAP: feed-row delete affordance — structurally-neutral icon-less button.
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      aria-label={t('delete')}
      className="rounded-md px-2 py-0.5 text-xs text-faint transition-colors duration-150 hover:text-err disabled:opacity-50 motion-reduce:transition-none"
    >
      {t('delete')}
    </button>
  );
}
