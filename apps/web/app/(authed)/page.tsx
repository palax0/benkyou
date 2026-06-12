import { getTranslations } from 'next-intl/server';
import { listFeed, getSourceName } from '@benkyou/core/items';
import { ItemCard } from '@/components/ItemCard';

const PAGE_SIZE = 30;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; source?: string }>;
}) {
  const t = await getTranslations('feed');
  const { page, source } = await searchParams;
  const pageNum = Math.max(1, Number(page ?? '1') || 1);
  const feed = await listFeed({ limit: PAGE_SIZE, offset: (pageNum - 1) * PAGE_SIZE, sourceId: source });
  const sourceName = source ? await getSourceName(source) : null;
  const qs = (p: number): string =>
    source ? `/?source=${encodeURIComponent(source)}&page=${p}` : `/?page=${p}`;

  return (
    <main>
      <h1 className="mb-4 text-xl font-bold">{t('title')}</h1>
      {source ? (
        <div className="mb-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <span>{t('filteredBy', { name: sourceName ?? source, count: feed.length })}</span>
          <a href="/" className="underline">
            ✕ {t('clearFilter')}
          </a>
        </div>
      ) : null}
      {feed.length === 0 ? (
        <p className="text-slate-500">{t('empty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {feed.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
      <div className="mt-6 flex justify-between text-sm text-slate-500">
        {pageNum > 1 ? <a href={qs(pageNum - 1)}>← {t('prev')}</a> : <span />}
        {feed.length === PAGE_SIZE ? <a href={qs(pageNum + 1)}>{t('next')} →</a> : <span />}
      </div>
    </main>
  );
}
