import { getTranslations } from 'next-intl/server';
import type { SourceTypeInfo } from '@benkyou/core/sources';
import type { SourceWithStats } from '@benkyou/core/sources';
import type { SourcePipelineStatus as SourcePipelineStatusData } from '@benkyou/core/items';
import { AddSourceForm } from './AddSourceForm';
import { SourceList } from './SourceList';

// One block per catalog entry (spec §2.2). Implemented types render their feed
// list + add form; planned types render a disabled placeholder labelled with the
// owning milestone (prevents the "RSS manager" misread; spec §10).
export async function SourceTypeBlock({
  info,
  sources,
  statuses,
}: {
  info: SourceTypeInfo;
  sources: SourceWithStats[];
  statuses: Record<string, SourcePipelineStatusData>;
}) {
  const t = await getTranslations('sources');
  const title = info.type === 'rss' ? t('rssTitle') : t(`typeName.${info.type}` as 'typeName.youtube');

  if (info.status === 'planned') {
    return (
      <section className="flex items-center justify-between rounded-md border border-line px-4 py-3 text-sm opacity-60">
        <span className="text-muted">{title}</span>
        <span className="text-xs text-faint">{t('plannedBadge', { milestone: info.milestone ?? '' })}</span>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-ink">
          {title} <span className="text-sm font-normal text-faint">({sources.length})</span>
        </h2>
        {/* DESIGN-GAP: inline add-form disclosure styling — neutral <details> for now */}
        <details>
          <summary className="cursor-pointer text-sm text-accent">{t('addRss')}</summary>
          <div className="mt-2">
            <AddSourceForm />
          </div>
        </details>
      </div>
      <SourceList sources={sources} statuses={statuses} />
    </section>
  );
}
