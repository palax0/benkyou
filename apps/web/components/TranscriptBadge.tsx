import { useTranslations } from 'next-intl';

// DESIGN-GAP: transcript-status badge. Structurally-neutral chip; the impeccable
// polish pass adds per-status color/iconography. Renders nothing for 'na'.
export function TranscriptBadge({ status }: { status: string }) {
  const t = useTranslations('item');
  if (status === 'na' || status === '') return null;
  const known = ['present', 'unavailable', 'pending'].includes(status) ? status : 'pending';
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
      {/* DESIGN-GAP: transcript badge color/icon per status */}
      {t(`transcript.${known}` as 'transcript.present')}
    </span>
  );
}
