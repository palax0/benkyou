import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { hybridSearch } from '@benkyou/core/search';
import { getUserSettings, isAiConfigured } from '@benkyou/core/settings';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const t = await getTranslations('search');
  const settings = await getUserSettings();

  if (!settings || !isAiConfigured(settings)) {
    return (
      <main>
        <h1 className="mb-4 font-serif text-xl font-semibold text-ink">{t('title')}</h1>
        <p className="text-muted">
          <Link href="/settings">{t('aiRequired')}</Link>
        </p>
      </main>
    );
  }

  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const hits = query ? await hybridSearch(query, {}, 20) : [];

  return (
    <main>
      <h1 className="mb-4 font-serif text-xl font-semibold text-ink">{t('title')}</h1>
      <form action="/search" method="get" className="mb-4">
        <input
          name="q"
          defaultValue={query}
          placeholder={t('placeholder')}
          className="w-full rounded-md border border-line bg-surface p-2"
        />
      </form>

      {query && hits.length === 0 ? <p className="text-muted">{t('noResults')}</p> : null}

      <div className="flex flex-col gap-3">
        {hits.map((h) => (
          <article key={h.id} className="rounded-md border border-line p-3">
            <div className="mb-1 text-xs text-faint">
              {h.sourceName ?? ''}
              {h.category ? ` · ${h.category === 'news' ? '📰' : '📚'}` : ''}
            </div>
            <h2 className="font-semibold text-ink">
              <Link href={`/items/${h.id}`}>{h.title}</Link>
            </h2>
            {h.headline ?? h.summary ? (
              <p className="mt-1 text-sm text-muted">{h.headline ?? h.summary}</p>
            ) : null}
          </article>
        ))}
      </div>
    </main>
  );
}
