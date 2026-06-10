import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { SourceWithStats } from '@benkyou/core/sources';
import { toggleSourceAction, fetchSourceNowAction } from './actions';
import { EditSourceForm } from './EditSourceForm';
import { DeleteSourceForm } from './DeleteSourceForm';

export async function SourceList({ sources }: { sources: SourceWithStats[] }) {
  const t = await getTranslations('sources');
  if (sources.length === 0) return <p className="text-slate-500">{t('empty')}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {sources.map((s) => (
        <li key={s.id} className="rounded border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded bg-slate-100 px-1.5 text-xs dark:bg-slate-800">{s.type}</span>
            <span className="font-semibold">{s.name}</span>
            <a href={s.url} className="max-w-xs truncate text-slate-500" target="_blank" rel="noreferrer">{s.url}</a>
            <span className="text-slate-500">{t('weight')}: {s.weight}</span>
            <form action={toggleSourceAction}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="enabled" value={String(!s.enabled)} />
              <button type="submit" className="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-600">
                {s.enabled ? t('pause') : t('enable')}
              </button>
            </form>
            <span className="text-slate-500">
              {s.lastPolledAt ? t('polledAt', { time: new Date(s.lastPolledAt).toLocaleString() }) : t('neverPolled')}
            </span>
            {s.lastFetchError ? (
              <details className="text-red-600"><summary>✗ {t('fetchError')}</summary><pre className="whitespace-pre-wrap text-xs">{s.lastFetchError}</pre></details>
            ) : (
              <span className="text-green-600">✓</span>
            )}
            <Link href={`/?source=${s.id}`} className="text-slate-500 underline">
              {t('itemCount', { count: s.itemCount })}
            </Link>
            <form action={fetchSourceNowAction} className="ml-auto">
              <input type="hidden" name="id" value={s.id} />
              <button type="submit" className="rounded border border-slate-300 px-2 py-0.5 dark:border-slate-600">{t('fetchNow')}</button>
            </form>
            <DeleteSourceForm id={s.id} />
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-slate-500">{t('edit')}</summary>
            <EditSourceForm id={s.id} defaults={{ name: s.name, url: s.url, weight: s.weight ?? '1' }} />
          </details>
        </li>
      ))}
    </ul>
  );
}
