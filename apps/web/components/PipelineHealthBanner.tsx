import type { Route } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getPipelineHealth } from '@benkyou/core/pipeline';

// Calm status banner (DESIGN.md Principle 5: state is visible but never alarms).
// The container stays neutral surface; severity is a single scarce-color dot —
// `err` for a genuine failure (matches the ContextRail failed-count precedent),
// `muted` for the softer "tasks appear lost" diagnostic. No red blocks, static dot
// (a pulsing failure would read as alarm). Priority: failing sources (actionable
// at /sources) over failed/orphan items. Renders nothing when the pipeline is healthy.
const DOT = { err: 'bg-err', muted: 'bg-muted' } as const;

export async function PipelineHealthBanner() {
  const h = await getPipelineHealth();
  const t = await getTranslations('banner');

  let message: string | null = null;
  let href: Route = '/admin/jobs';
  let tone: keyof typeof DOT = 'err';
  if (h.failingSources > 0) {
    message = t('failingSources', { n: h.failingSources });
    href = '/sources';
  } else if (h.failedItems > 0) {
    message = t('failedItems', { n: h.failedItems });
  } else if (h.orphans > 0) {
    message = t('orphans', { n: h.orphans });
    tone = 'muted';
  }
  if (!message) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-2 text-sm text-ink"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
        <span className="truncate">{message}</span>
      </span>
      <Link
        href={href}
        className="shrink-0 text-accent underline-offset-2 transition-colors duration-150 hover:underline motion-reduce:transition-none"
      >
        {t('cta')}
      </Link>
    </div>
  );
}
