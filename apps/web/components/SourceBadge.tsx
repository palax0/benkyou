import Link from 'next/link';

export function SourceBadge({ id, name }: { id: string | null; name: string | null }) {
  if (!name) return null;
  if (!id) return <span className="text-faint">{name}</span>;
  return (
    <Link
      href={`/?source=${encodeURIComponent(id)}`}
      className="rounded border border-line px-1.5 py-0.5 text-xs text-muted transition-colors duration-150 hover:bg-ink/5 hover:text-ink motion-reduce:transition-none"
    >
      {name}
    </Link>
  );
}
