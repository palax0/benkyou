import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getUserSettings } from '@benkyou/core/settings';
import { listSourcesWithStats } from '@benkyou/core/sources';
import { getTodayStats } from '@benkyou/core/items';

function RailHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2.5 text-xs font-medium text-faint">{children}</h2>;
}

export async function ContextRail() {
  const t = await getTranslations('shell');
  const [settings, sources, stats] = await Promise.all([
    getUserSettings(),
    listSourcesWithStats(),
    getTodayStats(),
  ]);

  const tags = settings?.interestTags ?? [];
  const topSources = sources
    .filter((s) => s.enabled && s.itemCount > 0)
    .sort((a, b) => b.itemCount - a.itemCount)
    .slice(0, 5);

  const statRows = [
    { key: 'addedToday', value: stats.addedToday },
    { key: 'doneToday', value: stats.doneToday },
    { key: 'inFlight', value: stats.inFlight },
    { key: 'failed', value: stats.failed },
  ] as const;

  return (
    <div className="flex flex-col gap-8 text-sm">
      <section>
        <RailHeading>{t('interests')}</RailHeading>
        {tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li
                key={tag}
                className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted"
              >
                {tag}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">
            {t('noInterests')}{' '}
            <Link href="/settings" className="text-accent hover:underline">
              {t('addInterests')}
            </Link>
          </p>
        )}
      </section>

      <section>
        <RailHeading>{t('topSources')}</RailHeading>
        {topSources.length > 0 ? (
          <ul className="flex flex-col">
            {topSources.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/?source=${encodeURIComponent(s.id)}`}
                  className="flex items-baseline justify-between gap-3 rounded-md px-1.5 py-1.5 -mx-1.5 text-muted transition-colors duration-150 hover:bg-ink/5 hover:text-ink motion-reduce:transition-none"
                >
                  <span className="truncate">{s.name}</span>
                  <span className="shrink-0 text-xs text-faint tabular-nums">
                    {t('itemCount', { count: s.itemCount })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">
            {t('noSources')}{' '}
            <Link href="/sources" className="text-accent hover:underline">
              {t('addSources')}
            </Link>
          </p>
        )}
      </section>

      <section>
        <RailHeading>{t('today')}</RailHeading>
        <dl className="flex flex-col gap-1.5">
          {statRows.map(({ key, value }) => (
            <div key={key} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">{t(key)}</dt>
              <dd
                className={`tabular-nums ${key === 'failed' && value > 0 ? 'font-medium text-err' : 'text-ink'}`}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <Link
          href="/admin/jobs"
          className="mt-3 inline-block text-xs text-accent hover:underline"
        >
          {t('viewPipeline')}
        </Link>
      </section>
    </div>
  );
}
