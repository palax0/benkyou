'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function ConfirmTranscribe({ itemId, estimatedMinutes }: { itemId: string; estimatedMinutes: number }) {
  const t = useTranslations('item');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await fetch(`/api/items/${itemId}/confirm-transcribe`, { method: 'POST' });
      router.refresh(); // double-click is a no-op server-side (endpoint guard)
    } finally {
      // On success router.refresh() remounts this; on a network error this re-enables retry.
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={confirm} disabled={busy}
      className="rounded-full border border-line px-3 py-1 text-sm text-ink disabled:opacity-50">
      {/* DESIGN-GAP: confirm action — structurally-neutral shell; impeccable polishes the look later */}
      {busy ? t('confirming') : t('confirmTranscribe', { minutes: estimatedMinutes })}
    </button>
  );
}
