export type TranscribeDecision =
  | { kind: 'transcribe' }
  | { kind: 'confirm'; estimatedMinutes: number }
  | { kind: 'skip'; status: 'skipped_too_long' | 'skipped_serverless' };

// Single chokepoint, called only from extract (async paste). Cost is audio minutes
// only — never money (spec §5.3). Branch order is significant.
export function transcribePolicy(i: {
  durationSec: number; isAdhoc: boolean;
  deployMode: 'docker' | 'serverless';
  autoLimit: number; manualLimit: number;
}): TranscribeDecision {
  // 1. serverless can't fit minute-scale work in a 10s budget (spec §11.2).
  if (i.deployMode === 'serverless') return { kind: 'skip', status: 'skipped_serverless' };
  // 2. within auto limit → transcribe (auto AND adhoc).
  if (i.durationSec <= i.autoLimit) return { kind: 'transcribe' };
  // 3. auto sources never prompt.
  if (!i.isAdhoc) return { kind: 'skip', status: 'skipped_too_long' };
  // 4. adhoc, auto < dur ≤ manual → confirm.
  if (i.durationSec <= i.manualLimit) return { kind: 'confirm', estimatedMinutes: Math.round(i.durationSec / 60) };
  // 5. adhoc over manual → skip+continue (revises §6.2 "拒绝粘贴").
  return { kind: 'skip', status: 'skipped_too_long' };
}
