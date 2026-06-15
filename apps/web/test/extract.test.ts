import { describe, expect, test } from 'vitest';
import { extractNoticeState } from '@/lib/extract';

describe('extractNoticeState', () => {
  test('non-article items never show an extract notice (videos use transcript_status)', () => {
    expect(extractNoticeState('video', 'blocked', false)).toEqual({ kind: 'none', titleOnly: false });
  });

  test('article + ok → no notice', () => {
    expect(extractNoticeState('article', 'ok', true)).toEqual({ kind: 'none', titleOnly: false });
  });

  test('article + failure + no body → missing notice + title-only summary', () => {
    expect(extractNoticeState('article', 'blocked', false)).toEqual({ kind: 'missing', titleOnly: true });
  });

  test('article + failure + has body (partial) → incomplete notice, summary not title-only', () => {
    expect(extractNoticeState('article', 'blocked', true)).toEqual({ kind: 'partial', titleOnly: false });
  });
});
