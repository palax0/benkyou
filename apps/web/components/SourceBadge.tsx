import Link from 'next/link';

export function SourceBadge({ id, name }: { id: string | null; name: string | null }) {
  if (!name) return null;
  if (!id) return <span className="text-slate-500">{name}</span>;
  return (
    <Link
      href={`/?source=${encodeURIComponent(id)}`}
      className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {name}
    </Link>
  );
}
