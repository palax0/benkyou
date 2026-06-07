import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isInitialized } from '@benkyou/core/setup';
import { env } from '@benkyou/core/config';
import { SetupForm } from './SetupForm';

export default async function SetupPage() {
  if (await isInitialized()) redirect('/login');
  const t = await getTranslations('setup');
  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>
      {env.INITIAL_PASSWORD ? <SetupForm embedDim={env.EMBED_DIM} /> : <p className="text-red-600">{t('needInitialPassword')}</p>}
    </main>
  );
}
