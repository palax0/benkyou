import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { hybridSearch } from '@benkyou/core/search';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const t = await getTranslations('search');
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const hits = query ? await hybridSearch(query, {}, 20) : [];

  return (
    <main>
      <h1 className="mb-4 text-xl font-bold">{t('title')}</h1>
      <form action="/search" method="get" className="mb-4">
        <input
          name="q"
          defaultValue={query}
          placeholder={t('placeholder')}
          className="w-full rounded border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800"
        />
      </form>

      {query && hits.length === 0 ? <p className="text-slate-500">{t('noResults')}</p> : null}

      <div className="flex flex-col gap-3">
        {hits.map((h) => (
          <article key={h.id} className="rounded border border-slate-200 p-3 dark:border-slate-700">
            <div className="mb-1 text-xs text-slate-500">
              {h.sourceName ?? ''}
              {h.category ? ` · ${h.category === 'news' ? '📰' : '📚'}` : ''}
            </div>
            <h2 className="font-semibold">
              <Link href={`/items/${h.id}`}>{h.title}</Link>
            </h2>
            {h.headline ?? h.summary ? (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{h.headline ?? h.summary}</p>
            ) : null}
          </article>
        ))}
      </div>
    </main>
  );
}
