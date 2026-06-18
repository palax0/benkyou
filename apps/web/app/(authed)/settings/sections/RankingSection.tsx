'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { matchPreset, RANKING_PRESETS, type RankingPreset } from '@benkyou/core/settings/ranking-presets';
import { updateRankingAction, type SettingsState } from '../actions';

const PRESETS = Object.keys(RANKING_PRESETS) as RankingPreset[];

export function RankingSection({ weights }: { weights: { alpha: number; beta: number; gamma: number } }) {
  const t = useTranslations('settings');
  const [statePreset, actionPreset] = useActionState<SettingsState, FormData>(updateRankingAction, {});
  const [stateCustom, actionCustom] = useActionState<SettingsState, FormData>(updateRankingAction, {});
  const current = matchPreset(weights);

  return (
    <div className="flex flex-col gap-4 text-sm">
      {/* Form A: preset radio chips — submits "preset" name; action takes the if branch */}
      <form action={actionPreset} className="flex flex-col gap-3">
        <span className="text-ink">{t('rankingStyle')}</span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <label key={p} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1 text-muted">
              <input type="radio" name="preset" value={p} defaultChecked={current === p} />
              {t(`preset.${p}` as 'preset.balanced')}
            </label>
          ))}
          {current === 'custom' ? (
            <span className="flex items-center rounded-full border border-line px-3 py-1 text-faint">
              {t('preset.custom')}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted">{t('rankingHelp')}</p>
        {statePreset.ok ? <p className="text-xs text-accent">{t('saved')}</p> : null}
        <button type="submit" className="self-start rounded-md bg-accent-vivid px-4 py-1.5 text-bg">
          {t('save')}
        </button>
      </form>

      {/* Form B: advanced custom weights — no "preset" field; action falls to else branch and writes α/β/γ directly */}
      <details>
        <summary className="cursor-pointer text-sm text-accent">{t('advancedWeights')}</summary>
        <form action={actionCustom} className="mt-2 flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            {(['alpha', 'beta', 'gamma'] as const).map((k) => (
              <label key={k} className="flex items-center gap-1.5 text-muted">
                {t(k)}
                <input
                  name={k}
                  type="number"
                  step="0.05"
                  min="0"
                  defaultValue={weights[k]}
                  className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-ink"
                />
              </label>
            ))}
          </div>
          {stateCustom.ok ? <p className="text-xs text-accent">{t('saved')}</p> : null}
          <button type="submit" className="self-start rounded-md bg-accent-vivid px-4 py-1.5 text-bg">
            {t('save')}
          </button>
        </form>
      </details>
    </div>
  );
}
