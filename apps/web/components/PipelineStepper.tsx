'use client';

import { useTranslations } from 'next-intl';
import { PIPELINE_STEPS, type StepView } from '@benkyou/core/items/pipeline-view';
// TranscriptStatus values that have a translation key in the 'item.transcript'
// namespace. 'skipped_too_long' and 'skipped_serverless' are internal pipeline
// states with no user-visible label — suppress the sub-label for those.
const LABELED_TRANSCRIPT_STATUSES = ['present', 'unavailable', 'pending', 'na'] as const;
type LabeledTranscriptStatus = (typeof LABELED_TRANSCRIPT_STATUSES)[number];

function isLabeledTranscriptStatus(s: string | null): s is LabeledTranscriptStatus {
  return s != null && (LABELED_TRANSCRIPT_STATUSES as readonly string[]).includes(s);
}

// Calm-Status dots (DESIGN.md §5): muted+pulse = active, accent = complete,
// faint = pending, err = failed. No flashing on failed (static err dot).
export function PipelineStepper({ view, lastError }: { view: StepView; lastError: string | null }) {
  const t = useTranslations('pipeline');
  const ti = useTranslations('item');

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        {PIPELINE_STEPS.map((step, i) => {
          const complete = !view.failed && i < view.activeIndex;
          const active = !view.failed && i === view.activeIndex;
          const failed = view.failed && i === view.activeIndex;
          const dot = failed
            ? 'bg-err'
            : complete
              ? 'bg-accent'
              : active
                ? 'bg-muted animate-pulse motion-reduce:animate-none'
                : 'bg-faint';
          const label = failed || active ? 'text-ink' : complete ? 'text-muted' : 'text-faint';
          const showSub = active && isLabeledTranscriptStatus(view.transcriptSub);
          return (
            <li key={step} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className="text-faint">—</span>}
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              <span className={label}>{t(step)}</span>
              {showSub ? (
                <span className="text-xs text-muted">· {ti(`transcript.${view.transcriptSub as LabeledTranscriptStatus}`)}</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {view.failed && lastError ? (
        <pre className="whitespace-pre-wrap text-xs text-muted">{lastError}</pre>
      ) : null}
    </div>
  );
}
