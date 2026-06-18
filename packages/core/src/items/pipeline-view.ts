import type { PerItemStage } from '../pipeline/state';
import type { TranscriptStatus } from '../sources/types';

// The ONE user-facing pipeline vocabulary (spec §3.1). Reused at single-item,
// single-source, and any future scope — never re-defined in a UI layer.
export const PIPELINE_STEPS = ['fetch', 'extract', 'embed', 'score', 'done'] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export interface StepView {
  // 0-based index into PIPELINE_STEPS of the in-progress step; 5 when fully done.
  activeIndex: number;
  failed: boolean;
  // Non-null only while the active step is 'extract' for a video (transcript_status != 'na').
  transcriptSub: TranscriptStatus | null;
}

// dedup + summary are internal-only stages (spec §3.1): both surface as the
// fifth step ("完成") still in progress, never as their own user-facing steps.
const STAGE_STEP_INDEX: Record<PerItemStage, number> = {
  extract: 1,
  embed: 2,
  score: 3,
  dedup: 4,
  summary: 4,
};

function isPerItemStage(s: string | null): s is PerItemStage {
  return s != null && s in STAGE_STEP_INDEX;
}

export function mapStep(
  state: string,
  currentStage: string | null,
  transcriptStatus: string,
  // Part of the pinned signature (spec §3.1); the UI renders last_error separately.
  _lastError: string | null,
): StepView {
  // current_stage is the primary axis: state='pending' alone can't tell
  // "just created" from "extracting"/"transcribing". A null/unknown stage on a
  // not-yet-advanced item means extract is the next/active step.
  const activeIndex = isPerItemStage(currentStage) ? STAGE_STEP_INDEX[currentStage] : 1;
  const transcriptSub =
    activeIndex === 1 && transcriptStatus !== 'na' ? (transcriptStatus as TranscriptStatus) : null;

  if (state === 'done') return { activeIndex: 5, failed: false, transcriptSub: null };
  if (state === 'failed') return { activeIndex, failed: true, transcriptSub };
  return { activeIndex, failed: false, transcriptSub };
}
