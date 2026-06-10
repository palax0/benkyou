import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getItemForUser } from '@benkyou/core/items';
import { DeepSummary } from '@/components/DeepSummary';

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getItemForUser(id);
  if (!item) notFound();
  const t = await getTranslations('item');

  return (
    <main className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">{item.title}</h1>
        <div className="mt-1 text-sm text-slate-500">
          {item.sourceName ? <span>{item.sourceName}</span> : null}
          {item.author ? <span> · {item.author}</span> : null}
          {item.publishedAt ? <span> · {new Date(item.publishedAt).toLocaleDateString()}</span> : null}
          {' · '}
          <a href={item.url} target="_blank" rel="noreferrer" className="underline">
            {t('original')}
          </a>
        </div>
      </header>

      <DeepSummary itemId={item.id} initial={item.deepSummary} />

      {item.rawContent ? (
        <article className="whitespace-pre-wrap text-sm leading-relaxed">{item.rawContent}</article>
      ) : (
        <p className="text-sm text-slate-500">{t('noContent')}</p>
      )}
    </main>
  );
}
