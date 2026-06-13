import Link from 'next/link';
import type { FeedItem } from '@benkyou/core/items';
import { SourceBadge } from '@/components/SourceBadge';

const TYPE_ICON: Record<string, string> = {
  article: '📄',
  video: '🎥',
  discussion: '💬',
  paper: '📑',
};

export function ItemCard({ item }: { item: FeedItem }) {
  return (
    <article className="rounded border border-line bg-surface p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-faint">
        <span>{TYPE_ICON[item.contentType] ?? '📄'}</span>
        <SourceBadge id={item.sourceId} name={item.sourceName} />
        {item.category ? <span>· {item.category === 'news' ? '📰' : '📚'}</span> : null}
        {item.publishedAt ? <span>· {new Date(item.publishedAt).toLocaleDateString()}</span> : null}
      </div>
      <h2 className="font-semibold">
        <Link href={`/items/${item.id}`}>{item.title}</Link>
      </h2>
      {item.summary ? <p className="mt-1 text-sm text-muted">{item.summary}</p> : null}
    </article>
  );
}
