import { getTranslations } from 'next-intl/server';
import { listFeed } from '@benkyou/core/items';
import { ItemCard } from '@/components/ItemCard';

const PAGE_SIZE = 30;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const t = await getTranslations('feed');
  const { page } = await searchParams;
  const pageNum = Math.max(1, Number(page ?? '1') || 1);
  const feed = await listFeed({ limit: PAGE_SIZE, offset: (pageNum - 1) * PAGE_SIZE });

  return (
    <main>
      <h1 className="mb-4 text-xl font-bold">{t('title')}</h1>
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
        {pageNum > 1 ? <a href={`/?page=${pageNum - 1}`}>← {t('prev')}</a> : <span />}
        {feed.length === PAGE_SIZE ? <a href={`/?page=${pageNum + 1}`}>{t('next')} →</a> : <span />}
      </div>
    </main>
  );
}
