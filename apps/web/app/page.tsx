import { useTranslations } from 'next-intl';

export default function HomePage() {
  const t = useTranslations('home');
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-sm text-slate-500">{t('subtitle')}</p>
    </main>
  );
}
