'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';

export function PasteForm() {
  const t = useTranslations('paste');
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/items/paste', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      setError(t('failed'));
      return;
    }
    const data = (await res.json()) as { created?: string; existing?: string };
    const id = data.created ?? data.existing;
    if (id) startTransition(() => router.push(`/items/${id}` as Route));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('placeholder')}
          className="flex-1 rounded border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-line px-3 py-2 text-sm text-ink disabled:opacity-50"
        >
          {t('submit')}
        </button>
      </div>
      {error ? <p className="text-sm text-muted">{error}</p> : null}
    </form>
  );
}
