import { getTranslations } from 'next-intl/server';
import { getUserSettings } from '@benkyou/core/settings';
import { SettingsForm } from './SettingsForm';
import { PasswordForm } from './PasswordForm';

export default async function SettingsPage() {
  const t = await getTranslations('settings');
  const settings = await getUserSettings();
  if (!settings) return null; // authed layout guarantees initialized; defensive

  return (
    <main className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-bold">{t('title')}</h1>
        <h2 className="mb-2 font-semibold">{t('providerSection')}</h2>
        <SettingsForm settings={settings} embedDim={settings.embedDim} />
      </section>
      <section>
        <h2 className="mb-2 font-semibold">{t('passwordSection')}</h2>
        <PasswordForm />
      </section>
    </main>
  );
}
