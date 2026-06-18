import { listSourcesWithStats, SOURCE_TYPE_CATALOG } from '@benkyou/core/sources';
import { getSourcePipelineStatus, getAdhocCount, type SourcePipelineStatus } from '@benkyou/core/items';
import { getUserSettings } from '@benkyou/core/settings';
import { getTranslations } from 'next-intl/server';
import { AutoRefresh } from '@/components/AutoRefresh';
import { SourcesOverviewBar } from './SourcesOverviewBar';
import { SourceTypeBlock } from './SourceTypeBlock';
import { AdhocCard } from './AdhocCard';

export default async function SourcesPage() {
  const t = await getTranslations('sources');
  const [sources, settings] = await Promise.all([listSourcesWithStats(), getUserSettings()]);

  const enabled = sources.filter((s) => s.enabled).length;
  const failed = sources.filter((s) => s.lastFetchError || s.consecutiveFailures > 0).length;

  // Per-source pipeline status only for implemented types' sources (cheap; single user).
  const statusEntries = await Promise.all(
    sources.map(async (s): Promise<[string, SourcePipelineStatus]> => [s.id, await getSourcePipelineStatus(s.id)]),
  );
  const statuses = Object.fromEntries(statusEntries);

  const adhocCount = settings ? await getAdhocCount() : 0;

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-xl font-semibold text-ink">{t('title')}</h1>
        <AutoRefresh />
      </div>
      <SourcesOverviewBar total={sources.length} enabled={enabled} failed={failed} />

      {SOURCE_TYPE_CATALOG.map((info) => (
        <SourceTypeBlock
          key={info.type}
          info={info}
          sources={sources.filter((s) => s.type === info.type)}
          statuses={statuses}
        />
      ))}

      <AdhocCard adhocWeight={settings?.adhocSourceWeight ?? '1.0'} count={adhocCount} />
    </main>
  );
}
