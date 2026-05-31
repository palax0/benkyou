import Link from 'next/link';
import type { FeedItem } from '@benkyou/core/items';

const TYPE_ICON: Record<string, string> = {
  article: '📄',
  video: '🎥',
  discussion: '💬',
  paper: '📑',
};

export function ItemCard({ item }: { item: FeedItem }) {
  return (
    <article className="rounded border border-slate-200 p-3 dark:border-slate-700">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>{TYPE_ICON[item.contentType] ?? '📄'}</span>
        {item.sourceName ? <span>{item.sourceName}</span> : null}
        {item.category ? <span>· {item.category === 'news' ? '📰' : '📚'}</span> : null}
        {item.publishedAt ? <span>· {new Date(item.publishedAt).toLocaleDateString()}</span> : null}
      </div>
      <h2 className="font-semibold">
        <Link href={`/items/${item.id}`}>{item.title}</Link>
      </h2>
      {item.summary ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{item.summary}</p>
      ) : null}
    </article>
  );
}
