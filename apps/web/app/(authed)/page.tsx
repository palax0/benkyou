import Link from 'next/link';
import type { Route } from 'next';
import { getTranslations } from 'next-intl/server';
import { listFeed, getSourceName } from '@benkyou/core/items';
import { ItemCard } from '@/components/ItemCard';
import { CloseIcon, FeedIcon } from '@/components/shell/icons';
import { PasteForm } from './items/PasteForm';

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
  // typedRoutes can't infer dynamic query strings; the path is a known static route.
  const qs = (p: number): Route =>
    (source ? `/?source=${encodeURIComponent(source)}&page=${p}` : `/?page=${p}`) as Route;

  return (
    <main>
      <h1 className="font-serif text-xl font-semibold tracking-tight text-ink">{t('title')}</h1>

      <div className="mt-4 mb-2">
        <PasteForm />
      </div>

      {source ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-muted">
          <span>{t('filteredBy', { name: sourceName ?? source, count: feed.length })}</span>
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink motion-reduce:transition-none"
          >
            <CloseIcon width={14} height={14} />
            {t('clearFilter')}
          </Link>
        </div>
      ) : null}

      {feed.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <FeedIcon width={28} height={28} className="text-faint" />
          <p className="max-w-sm text-sm text-muted">{t('empty')}</p>
        </div>
      ) : (
        <div className="mt-5 divide-y divide-line">
          {feed.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {feed.length > 0 && (pageNum > 1 || feed.length === PAGE_SIZE) ? (
        <nav className="mt-8 flex items-center justify-between border-t border-line pt-4 text-sm">
          {pageNum > 1 ? (
            <Link
              href={qs(pageNum - 1)}
              className="text-muted transition-colors duration-150 hover:text-accent motion-reduce:transition-none"
            >
              ← {t('prev')}
            </Link>
          ) : (
            <span />
          )}
          {feed.length === PAGE_SIZE ? (
            <Link
              href={qs(pageNum + 1)}
              className="text-muted transition-colors duration-150 hover:text-accent motion-reduce:transition-none"
            >
              {t('next')} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
