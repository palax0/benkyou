import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getItemForUser, getItemProgress, mapStep } from '@benkyou/core/items';
import { DeepSummary } from '@/components/DeepSummary';
import { AutoRefresh } from '@/components/AutoRefresh';
import { TranscriptBadge } from '@/components/TranscriptBadge';
import { ArticleBody } from '@/components/ArticleBody';
import { ExtractNotice, SummaryBasisBadge } from '@/components/ExtractNotice';
import { PipelineStepper } from '@/components/PipelineStepper';
import { ConfirmTranscribe } from '@/components/ConfirmTranscribe';

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getItemForUser(id);
  const t = await getTranslations('item');

  if (!item) {
    // Not done yet (or doesn't exist) — show pipeline progress if it exists.
    const progress = await getItemProgress(id);
    if (!progress) notFound();
    const view = mapStep(progress.state, progress.currentStage, progress.transcriptStatus, progress.lastError);
    return (
      <main className="flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <h1 className="font-serif text-2xl leading-snug font-semibold text-balance text-ink">
            {t('processingTitle')}
          </h1>
          <AutoRefresh />
        </header>
        <p className="text-sm text-muted">{progress.title}</p>
        <PipelineStepper view={view} lastError={progress.lastError} itemId={progress.id} />
        {progress.transcriptStatus === 'needs_confirmation' ? (
          <ConfirmTranscribe
            itemId={progress.id}
            estimatedMinutes={Math.round((progress.durationSec ?? 0) / 60)}
          />
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
        {item.contentType === 'video' || item.contentType === 'audio' ? (
          <div className="mt-2">
            <TranscriptBadge status={item.transcriptStatus} />
          </div>
        ) : null}
        {/* DESIGN-GAP: audio player shell — structurally-neutral; impeccable polishes later */}
        {item.contentType === 'audio' ? (
          <div className="mt-2">
            <audio controls src={item.mediaUrl ?? item.url} />
          </div>
        ) : null}
        <div className="mt-2">
          <ExtractNotice
            contentType={item.contentType}
            extractStatus={item.extractStatus}
            hasContentMd={Boolean(item.contentMd)}
            url={item.url}
          />
        </div>
      </header>

      <div className="flex flex-col gap-2">
        <SummaryBasisBadge
          contentType={item.contentType}
          extractStatus={item.extractStatus}
          hasContentMd={Boolean(item.contentMd)}
        />
        <DeepSummary itemId={item.id} initial={item.deepSummary} />
      </div>

      <ArticleBody contentMd={item.contentMd} rawContent={item.rawContent} emptyLabel={t('noContent')} />
    </main>
  );
}
