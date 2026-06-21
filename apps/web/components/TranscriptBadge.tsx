import { useTranslations } from 'next-intl';

// Calm, scarce-color status (DESIGN.md Principle 5 / The Restrained Rule):
//   present          → moss accent — captions are in, content is fully readable (a signal worth the scarce color)
//   pending          → muted + a working pulse (motion carries "in progress", not color)
//   needs_confirmation → muted, steady — waiting on the user, not working; recessive like pending but no pulse
//   unavailable      → faint, recessive — a missing caption is NORMAL (design §2 degradation), never an error/red
const STATUS = {
  present: 'text-accent',
  pending: 'text-muted',
  needs_confirmation: 'text-muted', // calm "awaiting" — recessive, not the moss accent, not error red
  unavailable: 'text-faint',
} as const;

type Known = keyof typeof STATUS;
const DOT: Record<Known, string> = {
  present: 'bg-accent',
  pending: 'bg-muted animate-pulse motion-reduce:animate-none',
  needs_confirmation: 'bg-muted', // steady (no pulse): it is waiting on the user, not working
  unavailable: 'bg-faint',
};

export function TranscriptBadge({ status }: { status: string }) {
  const t = useTranslations('item');
  if (status === 'na' || status === '') return null;
  const known: Known =
    status === 'present' || status === 'unavailable' || status === 'needs_confirmation' ? status : 'pending';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs ${STATUS[known]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[known]}`} />
      {t(`transcript.${known}` as 'transcript.present')}
    </span>
  );
}
