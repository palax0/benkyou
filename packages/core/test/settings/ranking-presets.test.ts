import { describe, expect, test } from 'vitest';
import { RANKING_PRESETS, matchPreset } from '../../src/settings/ranking-presets';

describe('ranking presets', () => {
  test('preset values match spec §5.3 table', () => {
    expect(RANKING_PRESETS.balanced).toEqual({ alpha: 0.6, beta: 0.3, gamma: 0.1 });
    expect(RANKING_PRESETS.relevance).toEqual({ alpha: 0.75, beta: 0.15, gamma: 0.1 });
    expect(RANKING_PRESETS.depth).toEqual({ alpha: 0.4, beta: 0.5, gamma: 0.1 });
    expect(RANKING_PRESETS.source).toEqual({ alpha: 0.5, beta: 0.2, gamma: 0.3 });
  });

  test('matchPreset round-trips a known preset', () => {
    expect(matchPreset({ alpha: 0.6, beta: 0.3, gamma: 0.1 })).toBe('balanced');
    expect(matchPreset({ alpha: 0.4, beta: 0.5, gamma: 0.1 })).toBe('depth');
  });

  test('off-preset weights → custom', () => {
    expect(matchPreset({ alpha: 0.5, beta: 0.5, gamma: 0.0 })).toBe('custom');
  });
});
