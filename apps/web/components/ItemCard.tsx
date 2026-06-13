import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { FeedItem } from '@benkyou/core/items';
import { SourceBadge } from '@/components/SourceBadge';
import {
  ArticleIcon,
  BookmarkIcon,
  DiscussionIcon,
  PaperIcon,
  VideoIcon,
} from '@/components/shell/icons';

const TYPE_ICON = {
  article: ArticleIcon,
  video: VideoIcon,
  discussion: DiscussionIcon,
  paper: PaperIcon,
} as const;

type ContentType = keyof typeof TYPE_ICON;

function asContentType(value: string): ContentType {
  return value in TYPE_ICON ? (value as ContentType) : 'article';
}

export async function ItemCard({ item }: { item: FeedItem }) {
  const t = await getTranslations('feed');
  const type = asContentType(item.contentType);
  const TypeIcon = TYPE_ICON[type];

  return (
    <article className="group relative isolate py-4">
      {/* Hover wash sits behind the content and bleeds past the text column so the
          row lights up like a list entry, not a boxed card. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -inset-x-3 -z-10 rounded-lg bg-transparent transition-colors duration-150 group-hover:bg-surface-2 motion-reduce:transition-none"
      />

      <div className="flex items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium tracking-wider text-faint uppercase">
          <TypeIcon width={14} height={14} className="shrink-0" />
          {t(`type.${type}`)}
        </span>
        <span aria-hidden className="text-line">
          ·
        </span>
        <span className="relative z-10 truncate text-muted">
          <SourceBadge id={item.sourceId} name={item.sourceName} />
        </span>
        {item.publishedAt ? (
          <>
            <span aria-hidden className="text-line">
              ·
            </span>
            <time
              dateTime={item.publishedAt.toISOString()}
              className="shrink-0 text-faint tabular-nums"
            >
              {item.publishedAt.toLocaleDateString()}
            </time>
          </>
        ) : null}
        {item.bookmarked ? (
          <span className="ml-auto inline-flex shrink-0 items-center text-accent">
            <BookmarkIcon width={14} height={14} />
            <span className="sr-only">{t('bookmarked')}</span>
          </span>
        ) : null}
      </div>

      <h2 className="mt-1.5 font-serif text-lg leading-snug font-semibold break-words text-ink">
        {/* Stretched link: the ::after covers the whole row for a large hit target,
            while the source link above re-enables its own pointer events via z-10. */}
        <Link
          href={`/items/${item.id}`}
          className="transition-colors duration-150 outline-none hover:text-accent after:absolute after:inset-y-0 after:-inset-x-3 after:rounded-lg after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-accent motion-reduce:transition-none"
        >
          {item.title}
        </Link>
      </h2>

      {item.summary ? (
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{item.summary}</p>
      ) : null}
    </article>
  );
}
