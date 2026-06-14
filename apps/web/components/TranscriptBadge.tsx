import { useTranslations } from 'next-intl';

// Calm, scarce-color status (DESIGN.md Principle 5 / The Restrained Rule):
//   present     → moss accent — captions are in, content is fully readable (a signal worth the scarce color)
//   pending     → muted + a working pulse (motion carries "in progress", not color)
//   unavailable → faint, recessive — a missing caption is NORMAL (design §2 degradation), never an error/red
const STATUS = {
  present: 'text-accent',
  pending: 'text-muted',
  unavailable: 'text-faint',
} as const;

type Known = keyof typeof STATUS;
const DOT: Record<Known, string> = {
  present: 'bg-accent',
  pending: 'bg-muted animate-pulse motion-reduce:animate-none',
  unavailable: 'bg-faint',
};

export function TranscriptBadge({ status }: { status: string }) {
  const t = useTranslations('item');
  if (status === 'na' || status === '') return null;
  const known: Known = status === 'present' || status === 'unavailable' ? status : 'pending';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs ${STATUS[known]}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[known]}`} />
      {t(`transcript.${known}` as 'transcript.present')}
    </span>
  );
}
