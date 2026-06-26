import { describe, expect, test } from 'vitest';
import { mapStep, PIPELINE_STEPS } from '../../src/items/pipeline-view';

describe('mapStep', () => {
  test('5-step vocabulary in order', () => {
    expect(PIPELINE_STEPS).toEqual(['fetch', 'extract', 'embed', 'score', 'done']);
  });

  test('just created (pending, no stage) → extract is the active step', () => {
    expect(mapStep('pending', null, 'na', null)).toEqual({ activeIndex: 1, failed: false, transcriptSub: null });
  });

  test('maps each internal stage to its user step', () => {
    expect(mapStep('pending', 'extract', 'na', null).activeIndex).toBe(1);
    expect(mapStep('extracted', 'embed', 'na', null).activeIndex).toBe(2);
    expect(mapStep('embedded', 'score', 'na', null).activeIndex).toBe(3);
    expect(mapStep('scored', 'dedup', 'na', null).activeIndex).toBe(4);
    expect(mapStep('dedup_done', 'summary', 'na', null).activeIndex).toBe(4);
  });

  test('done → all five complete (activeIndex 5)', () => {
    expect(mapStep('done', null, 'na', null)).toEqual({ activeIndex: 5, failed: false, transcriptSub: null });
  });

  test('failed → failed flag + step located by current_stage', () => {
    expect(mapStep('failed', 'extract', 'na', 'HTTP 403')).toEqual({ activeIndex: 1, failed: true, transcriptSub: null });
    expect(mapStep('failed', 'score', 'na', 'boom').failed).toBe(true);
  });

  test('video transcribing shows a transcript sub-status on the extract step', () => {
    expect(mapStep('pending', 'extract', 'pending', null).transcriptSub).toBe('pending');
    expect(mapStep('pending', 'extract', 'na', null).transcriptSub).toBeNull();
    // sub-status only on the extract step, not later steps
    expect(mapStep('embedded', 'score', 'pending', null).transcriptSub).toBeNull();
  });

  test('needs_confirmation surfaces as the extract sub-step (not folded away)', () => {
    const v = mapStep('pending', 'extract', 'needs_confirmation', null);
    expect(v).toEqual({ activeIndex: 1, failed: false, transcriptSub: 'needs_confirmation' });
  });
  test('pending transcript surfaces as transcribing sub-step', () => {
    const v = mapStep('pending', 'extract', 'pending', null);
    expect(v.transcriptSub).toBe('pending');
  });
});

import { describeItemStatus } from '../../src/items/pipeline-view';

describe('describeItemStatus', () => {
  test('done + present → done', () => {
    expect(describeItemStatus('done', null, 'present')).toEqual({ key: 'done' });
  });
  test('done + unavailable → doneNoTranscript', () => {
    expect(describeItemStatus('done', null, 'unavailable')).toEqual({ key: 'doneNoTranscript' });
  });
  test('failed → failed + user-facing step from current_stage', () => {
    expect(describeItemStatus('failed', 'embed', 'na')).toEqual({ key: 'failed', stepKey: 'embed' });
    expect(describeItemStatus('failed', 'extract', 'na')).toEqual({ key: 'failed', stepKey: 'extract' });
  });
  test('failed with null stage falls back to extract', () => {
    expect(describeItemStatus('failed', null, 'na')).toEqual({ key: 'failed', stepKey: 'extract' });
  });
  test('in-flight states → inFlight', () => {
    expect(describeItemStatus('pending', 'extract', 'na')).toEqual({ key: 'inFlight' });
    expect(describeItemStatus('scored', 'dedup', 'na')).toEqual({ key: 'inFlight' });
  });
});
