import { getTranslations } from 'next-intl/server';
import { getUserSettings } from '@benkyou/core/settings';
import { getCredentialStatus } from '@benkyou/core/sources';
import { AiServicesSection } from './sections/AiServicesSection';
import { RankingSection } from './sections/RankingSection';
import { InterestsSection } from './sections/InterestsSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { CredentialsSection } from './sections/CredentialsSection';
import { PasswordForm } from './PasswordForm';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const t = await getTranslations('settings');
  const settings = await getUserSettings();
  if (!settings) return null; // authed layout guarantees initialized; defensive
  const credentialStatus = await getCredentialStatus();
  const { llmApiKey, embedApiKey, readerApiKey, ...safeSettings } = settings;
  const weights = {
    alpha: Number(settings.weightAlpha ?? '0.6'),
    beta: Number(settings.weightBeta ?? '0.3'),
    gamma: Number(settings.weightGamma ?? '0.1'),
  };

  return (
    <main className="flex flex-col gap-10">
      <h1 className="font-serif text-xl font-semibold text-ink">{t('title')}</h1>
      <Section title={t('aiSection')}>
        <AiServicesSection
          settings={{
            ...safeSettings,
            llmApiKeyConfigured: Boolean(llmApiKey),
            embedApiKeyConfigured: Boolean(embedApiKey),
            readerApiKeyConfigured: Boolean(readerApiKey),
          }}
          embedDim={settings.embedDim}
        />
      </Section>
      <Section title={t('rankingSection')}>
        <RankingSection weights={weights} />
      </Section>
      <Section title={t('interestsSection')}>
        <InterestsSection tags={settings.interestTags ?? []} />
      </Section>
      <Section title={t('appearanceSection')}>
        <AppearanceSection locale={settings.locale as 'zh' | 'en'} />
      </Section>
      <Section title={t('credentialsSection')}>
        <CredentialsSection status={credentialStatus} />
      </Section>
      <Section title={t('accountSection')}>
        <PasswordForm />
      </Section>
    </main>
  );
}
