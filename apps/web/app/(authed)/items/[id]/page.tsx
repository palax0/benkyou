import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getItemForUser, getItemProgress } from '@benkyou/core/items';
import { DeepSummary } from '@/components/DeepSummary';
import { AutoRefresh } from '@/components/AutoRefresh';
import { TranscriptBadge } from '@/components/TranscriptBadge';

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getItemForUser(id);
  const t = await getTranslations('item');

  if (!item) {
    // Not done yet (or doesn't exist) — show pipeline progress if it exists.
    const progress = await getItemProgress(id);
    if (!progress) notFound();
    return (
      <main className="flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <h1 className="font-serif text-2xl leading-snug font-semibold text-balance text-ink">
            {t('processingTitle')}
          </h1>
          <AutoRefresh />
        </header>
        <p className="text-sm text-muted">
          {progress.state === 'failed'
            ? t('processingFailed', { stage: progress.currentStage ?? '' })
            : t('processingStage', { stage: progress.currentStage ?? progress.state })}
        </p>
        {progress.state === 'failed' && progress.lastError ? (
          <pre className="whitespace-pre-wrap text-xs text-muted">{progress.lastError}</pre>
        ) : null}
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-4">
      <header>
        <h1 className="font-serif text-2xl leading-snug font-semibold text-balance text-ink">
          {item.title}
        </h1>
        <div className="mt-2 text-sm text-muted">
          {item.sourceName ? <span>{item.sourceName}</span> : null}
          {item.author ? <span> · {item.author}</span> : null}
          {item.publishedAt ? <span> · {new Date(item.publishedAt).toLocaleDateString()}</span> : null}
          {' · '}
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-2 transition-colors duration-150 hover:underline motion-reduce:transition-none"
          >
            {t('original')}
          </a>
        </div>
        {item.contentType === 'video' ? (
          <div className="mt-2">
            <TranscriptBadge status={item.transcriptStatus} />
          </div>
        ) : null}
      </header>

      <DeepSummary itemId={item.id} initial={item.deepSummary} />

      {item.rawContent ? (
        <article className="whitespace-pre-wrap text-sm leading-relaxed">{item.rawContent}</article>
      ) : (
        <p className="text-sm text-muted">{t('noContent')}</p>
      )}
    </main>
  );
}
