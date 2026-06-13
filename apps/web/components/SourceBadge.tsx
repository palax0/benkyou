import Link from 'next/link';

export function SourceBadge({ id, name }: { id: string | null; name: string | null }) {
  if (!name) return null;
  if (!id) return <span>{name}</span>;
  return (
    <Link
      href={`/?source=${encodeURIComponent(id)}`}
      className="rounded-sm underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline motion-reduce:transition-none"
    >
      {name}
    </Link>
  );
}
