import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { SourcePipelineStatus as SourcePipelineStatusData } from '@benkyou/core/items';
import { PIPELINE_STEPS } from '@benkyou/core/items/pipeline-view';
import { retryItemAction } from '../admin/jobs/actions';

export async function SourcePipelineStatus({ status }: { status: SourcePipelineStatusData }) {
  const t = await getTranslations('sources');
  const tp = await getTranslations('pipeline');
  const calm = status.inFlight.length === 0 && status.failed.length === 0;

  if (calm) {
    return <span className="text-xs text-muted">{t('allDone', { n: status.doneCount })}</span>;
  }

  return (
    <details className="text-xs">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-muted">
        {status.inFlight.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted animate-pulse motion-reduce:animate-none" />
            {t('statusInFlight', { n: status.inFlight.length })}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          {t('statusDone', { n: status.doneCount })}
        </span>
        {status.failed.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-err">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-err" />
            {t('statusFailed', { n: status.failed.length })}
          </span>
        )}
      </summary>

      <ul className="mt-2 flex flex-col gap-1.5 border-l border-line pl-3">
        {status.inFlight.map((i) => (
          <li key={i.itemId} className="flex items-center justify-between gap-3">
            <Link href={`/items/${i.itemId}`} className="truncate text-muted hover:text-ink">
              {i.title}
            </Link>
            <span className="shrink-0 text-faint">{tp(PIPELINE_STEPS[i.step] ?? 'done')}</span>
          </li>
        ))}
        {status.failed.map((f) => (
          <li key={f.itemId} className="flex items-center justify-between gap-3 text-err">
            <span className="truncate">{f.title}</span>
            <form action={retryItemAction} className="shrink-0">
              <input type="hidden" name="itemId" value={f.itemId} />
              <button type="submit" className="rounded-md border border-line px-2 py-0.5 text-faint">
                {tp('retry')}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}
