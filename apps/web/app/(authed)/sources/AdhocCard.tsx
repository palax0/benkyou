import { getTranslations } from 'next-intl/server';
import { AdhocWeightForm } from './AdhocWeightForm';

// The manual-import pseudo-source (spec §2.2): NOT a sources row. Surfaces the
// adhoc_source_weight knob + its explanation + cumulative count + paste shortcut.
export async function AdhocCard({ adhocWeight, count }: { adhocWeight: string; count: number }) {
  const t = await getTranslations('sources');
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-ink">{t('adhocTitle')}</h2>
        <span className="text-xs text-faint">
          {t('adhocCount', { n: count })} · {t('adhocSubtitle')}
        </span>
      </div>
      <AdhocWeightForm defaultWeight={adhocWeight} />
    </section>
  );
}
