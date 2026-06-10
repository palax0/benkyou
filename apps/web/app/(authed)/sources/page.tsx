import { getTranslations } from 'next-intl/server';
import { listSourcesWithStats } from '@benkyou/core/sources';
import { AutoRefresh } from '@/components/AutoRefresh';
import { SourceList } from './SourceList';
import { AddSourceForm } from './AddSourceForm';

export default async function SourcesPage() {
  const t = await getTranslations('sources');
  const sources = await listSourcesWithStats();
  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <AutoRefresh />
      </div>
      <AddSourceForm />
      <SourceList sources={sources} />
    </main>
  );
}
