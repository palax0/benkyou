import { getTranslations } from 'next-intl/server';

export async function SourcesOverviewBar({
  total,
  enabled,
  failed,
}: {
  total: number;
  enabled: number;
  failed: number;
}) {
  const t = await getTranslations('sources');
  return (
    <div className="flex items-baseline gap-3 border-b border-line pb-3 text-sm">
      <span className="text-xs font-medium uppercase tracking-wider text-faint">{t('overview')}</span>
      <span className="text-muted">{t('overviewCounts', { total, enabled, failed })}</span>
    </div>
  );
}
