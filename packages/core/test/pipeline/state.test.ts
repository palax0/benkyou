import { describe, expect, test } from 'vitest';
import {
  NEXT_STAGE,
  PER_ITEM_STAGES,
  STAGE_REQUIRED_STATE,
  STAGE_RESULT_STATE,
} from '../../src/pipeline/state.js';

describe('pipeline state tables', () => {
  test('stages form a single chain extract → embed → score → dedup → summary', () => {
    expect(PER_ITEM_STAGES).toEqual(['extract', 'embed', 'score', 'dedup', 'summary']);
    expect(NEXT_STAGE.extract).toBe('embed');
    expect(NEXT_STAGE.summary).toBeNull();
  });

  test('each stage requires its predecessor state and yields the next state', () => {
    expect(STAGE_REQUIRED_STATE.extract).toBe('pending');
    expect(STAGE_RESULT_STATE.extract).toBe('extracted');
    expect(STAGE_REQUIRED_STATE.embed).toBe('extracted');
    expect(STAGE_RESULT_STATE.summary).toBe('done');
  });

  test('required-state of a stage equals result-state of the previous stage', () => {
    for (let i = 1; i < PER_ITEM_STAGES.length; i++) {
      const prev = PER_ITEM_STAGES[i - 1]!;
      const cur = PER_ITEM_STAGES[i]!;
      expect(STAGE_REQUIRED_STATE[cur]).toBe(STAGE_RESULT_STATE[prev]);
    }
  });
});
