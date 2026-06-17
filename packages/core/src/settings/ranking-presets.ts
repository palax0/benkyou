// Presets are UI sugar over user_settings.weight_alpha/beta/gamma (spec §5.3).
// The final_score formula stays single-point in packages/core; this only chooses
// which α/β/γ to write. Sums ≈ 1; revisit after M3 smart ranking ships.
export type RankingPreset = 'balanced' | 'relevance' | 'depth' | 'source';

export interface Weights {
  alpha: number;
  beta: number;
  gamma: number;
}

export const RANKING_PRESETS: Record<RankingPreset, Weights> = {
  balanced: { alpha: 0.6, beta: 0.3, gamma: 0.1 },
  relevance: { alpha: 0.75, beta: 0.15, gamma: 0.1 },
  depth: { alpha: 0.4, beta: 0.5, gamma: 0.1 },
  source: { alpha: 0.5, beta: 0.2, gamma: 0.3 },
};

const EPS = 1e-6;
const close = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

export function matchPreset(w: Weights): RankingPreset | 'custom' {
  for (const name of Object.keys(RANKING_PRESETS) as RankingPreset[]) {
    const p = RANKING_PRESETS[name];
    if (close(p.alpha, w.alpha) && close(p.beta, w.beta) && close(p.gamma, w.gamma)) return name;
  }
  return 'custom';
}
