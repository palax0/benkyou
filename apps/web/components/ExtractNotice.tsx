import { useTranslations } from 'next-intl';
import { extractNoticeState } from '@/lib/extract';

// Article fetch-status notice (design §7.2) + summary-basis badge (§7.3).
// Recessive, calm — a missing body is a normal degradation, not an error (no red).
// Link label reuses item.original (same key as the header "Original" link).
export function ExtractNotice({
  contentType,
  extractStatus,
  hasContentMd,
  url,
}: {
  contentType: string;
  extractStatus: string;
  hasContentMd: boolean;
  url: string;
}) {
  const t = useTranslations('item');
  const { kind } = extractNoticeState(contentType, extractStatus, hasContentMd);
  if (kind === 'none') return null;

  const reason = t(`extractReason.${extractStatus}` as 'extractReason.blocked');
  const label = kind === 'missing' ? t('extractMissing', { reason }) : t('extractPartial', { reason });

  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span>{label}</span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline-offset-2 transition-colors duration-150 hover:underline motion-reduce:transition-none"
      >
        {t('original')}
      </a>
    </p>
  );
}

// Small recessive badge: the AI summary was produced without a body (design §7.3).
export function SummaryBasisBadge({
  contentType,
  extractStatus,
  hasContentMd,
}: {
  contentType: string;
  extractStatus: string;
  hasContentMd: boolean;
}) {
  const t = useTranslations('item');
  const { titleOnly } = extractNoticeState(contentType, extractStatus, hasContentMd);
  if (!titleOnly) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-xs text-faint">
      {t('summaryTitleOnly')}
    </span>
  );
}
