import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { SourceWithStats } from '@benkyou/core/sources';
import type { SourcePipelineStatus as SourcePipelineStatusData } from '@benkyou/core/items';
import { toggleSourceAction, fetchSourceNowAction } from './actions';
import { EditSourceForm } from './EditSourceForm';
import { DeleteSourceForm } from './DeleteSourceForm';
import { SourcePipelineStatus } from './SourcePipelineStatus';

export async function SourceList({
  sources,
  statuses,
}: {
  sources: SourceWithStats[];
  statuses: Record<string, SourcePipelineStatusData>;
}) {
  const t = await getTranslations('sources');
  if (sources.length === 0) return <p className="text-sm text-muted">{t('empty')}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {sources.map((s) => {
        const st = statuses[s.id];
        return (
          <li key={s.id} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold text-ink">{s.name}</span>
              <a href={s.url} className="max-w-xs truncate text-muted" target="_blank" rel="noreferrer">{s.url}</a>
              <span className="text-faint">w{s.weight}</span>
              <span className="text-faint">{pollLabel(s.pollInterval)}</span>
              <form action={toggleSourceAction}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="enabled" value={String(!s.enabled)} />
                <button type="submit" className="rounded-md border border-line px-2 py-0.5 text-ink">
                  {s.enabled ? t('pause') : t('enable')}
                </button>
              </form>
              <Link href={`/?source=${s.id}`} className="text-muted underline-offset-2 hover:underline">
                {t('itemCount', { count: s.itemCount })}
              </Link>
              <form action={fetchSourceNowAction} className="ml-auto">
                <input type="hidden" name="id" value={s.id} />
                <button type="submit" className="rounded-md border border-line px-2 py-0.5 text-ink">{t('fetchNow')}</button>
              </form>
              <DeleteSourceForm id={s.id} />
            </div>

            {st ? <SourcePipelineStatus status={st} /> : null}
            {s.lastFetchError ? (
              <details className="text-xs text-err">
                <summary className="cursor-pointer">✗ {t('fetchError')}</summary>
                <pre className="whitespace-pre-wrap">{s.lastFetchError}</pre>
              </details>
            ) : null}

            <details>
              <summary className="cursor-pointer text-sm text-muted">{t('edit')}</summary>
              <EditSourceForm
                id={s.id}
                defaults={{ name: s.name, url: s.url, weight: s.weight ?? '1', pollInterval: s.pollInterval ?? 1800 }}
              />
            </details>
          </li>
        );
      })}
    </ul>
  );
}

// poll_interval is seconds in the DB; show minutes/hours (spec §5.2).
function pollLabel(seconds: number | null): string {
  const s = seconds ?? 1800;
  return s % 3600 === 0 ? `${s / 3600}h` : `${Math.round(s / 60)}m`;
}
