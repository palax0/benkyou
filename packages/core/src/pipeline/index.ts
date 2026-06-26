import type { PerItemStage, StageOutcome } from './state';
import { extractItem } from './extract';
import { embedItem } from './embed';
import { scoreItem } from './score';
import { dedupItem } from './dedup';
import { summarizeItem } from './summary';

export const STAGE_HANDLERS: Record<PerItemStage, (itemId: string) => Promise<void | StageOutcome>> = {
  extract: extractItem,
  embed: embedItem,
  score: scoreItem,
  dedup: dedupItem,
  summary: summarizeItem,
};

export { ingestSource } from './ingest';
export type { IngestResult } from './ingest';
export * from './state';
export * from './status';
export * from './retry';
export * from './reprocess';
export { getTranscribeView, setTranscriptStatus, writeTranscriptAndAdvance, degradeTranscriptAndAdvance } from './transcribe-store';
export type { TranscribeView } from './transcribe-store';
