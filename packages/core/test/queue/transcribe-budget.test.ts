import { describe, expect, test } from 'vitest';
import { transcribeBudgetSec, TRANSCRIBE_FIXED_OVERHEAD_SEC } from '../../src/queue/queues.js';

describe('transcribeBudgetSec', () => {
  test('a 0s audio still gets at least the fixed overhead', () => {
    expect(transcribeBudgetSec(0)).toBe(TRANSCRIBE_FIXED_OVERHEAD_SEC);
  });
  test('monotonic increasing in durationSec', () => {
    expect(transcribeBudgetSec(600)).toBeLessThan(transcribeBudgetSec(601));
    expect(transcribeBudgetSec(60)).toBeLessThan(transcribeBudgetSec(3600));
  });
  test('includes the 2x factor over the audio length', () => {
    expect(transcribeBudgetSec(1000)).toBe(2000 + TRANSCRIBE_FIXED_OVERHEAD_SEC);
  });
  test('is never equal to the audio length alone (decision #6)', () => {
    expect(transcribeBudgetSec(10800)).not.toBe(10800);
  });
});
