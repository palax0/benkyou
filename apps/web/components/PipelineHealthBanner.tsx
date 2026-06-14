import type { Route } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getPipelineHealth } from '@benkyou/core/pipeline';

// DESIGN-GAP: alert/banner. Structurally-neutral; polish pass adds severity styling.
// Priority: failing sources (actionable at /sources) over failed/orphan items
// (triaged at /admin/jobs). Renders nothing when the pipeline is healthy.
export async function PipelineHealthBanner() {
  const h = await getPipelineHealth();
  const t = await getTranslations('banner');

  let message: string | null = null;
  let href: Route = '/admin/jobs';
  if (h.failingSources > 0) {
    message = t('failingSources', { n: h.failingSources });
    href = '/sources';
  } else if (h.failedItems > 0) {
    message = t('failedItems', { n: h.failedItems });
  } else if (h.orphans > 0) {
    message = t('orphans', { n: h.orphans });
  }
  if (!message) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border border-line bg-surface px-4 py-2 text-sm text-ink"
    >
      {/* DESIGN-GAP: banner severity color/icon */}
      <span>{message}</span>
      <Link href={href} className="text-accent underline-offset-2 hover:underline">
        {t('cta')}
      </Link>
    </div>
  );
}
