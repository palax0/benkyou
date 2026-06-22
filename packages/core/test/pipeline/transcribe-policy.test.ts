import { describe, expect, test } from 'vitest';
import { transcribePolicy } from '../../src/pipeline/transcribe-policy.js';

const base = { isAdhoc: true, deployMode: 'docker' as const, autoLimit: 1800, manualLimit: 10800 };

describe('transcribePolicy', () => {
  test('serverless always skips with skipped_serverless (even within auto limit)', () => {
    expect(transcribePolicy({ ...base, durationSec: 60, deployMode: 'serverless' }))
      .toEqual({ kind: 'skip', status: 'skipped_serverless' });
  });
  test('within auto limit → transcribe (adhoc)', () => {
    expect(transcribePolicy({ ...base, durationSec: 1800 })).toEqual({ kind: 'transcribe' });
  });
  test('within auto limit → transcribe (auto source)', () => {
    expect(transcribePolicy({ ...base, durationSec: 1000, isAdhoc: false })).toEqual({ kind: 'transcribe' });
  });
  test('auto source over auto limit → skipped_too_long (never prompts)', () => {
    expect(transcribePolicy({ ...base, durationSec: 3600, isAdhoc: false }))
      .toEqual({ kind: 'skip', status: 'skipped_too_long' });
  });
  test('adhoc between auto and manual → confirm with estimatedMinutes', () => {
    expect(transcribePolicy({ ...base, durationSec: 3600 })).toEqual({ kind: 'confirm', estimatedMinutes: 60 });
  });
  test('adhoc over manual limit → skipped_too_long (direct-media over-limit skip, revises §6.2)', () => {
    expect(transcribePolicy({ ...base, durationSec: 20000 }))
      .toEqual({ kind: 'skip', status: 'skipped_too_long' });
  });
});
