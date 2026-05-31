import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isInitialized } from '@benkyou/core/setup';
import { getValidSession } from '@/lib/auth';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  if (!(await isInitialized())) redirect('/setup');
  if (await getValidSession()) redirect('/');
  const t = await getTranslations('login');
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>
      <LoginForm />
    </main>
  );
}
