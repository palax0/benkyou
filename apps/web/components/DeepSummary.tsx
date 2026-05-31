'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

export function DeepSummary({ itemId, initial }: { itemId: string; initial: string | null }) {
  const t = useTranslations('item');
  const [text, setText] = useState(initial ?? '');
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (initial || started.current) return;
    started.current = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/items/${itemId}/deep-summary`, { method: 'POST' });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setText(acc);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [itemId, initial]);

  return (
    <section className="rounded border border-slate-200 p-3 dark:border-slate-700">
      <h2 className="mb-2 font-semibold">{t('deepSummary')}</h2>
      {text ? (
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>
      ) : (
        <p className="text-sm text-slate-500">{loading ? t('generating') : t('noSummary')}</p>
      )}
    </section>
  );
}
