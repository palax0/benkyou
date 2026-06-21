import type { PerItemStage } from './state';
import { extractItem } from './extract';
import { embedItem } from './embed';
import { scoreItem } from './score';
import { dedupItem } from './dedup';
import { summarizeItem } from './summary';

export const STAGE_HANDLERS: Record<PerItemStage, (itemId: string) => Promise<void>> = {
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
export { getTranscribeView, writeTranscript, setTranscriptStatus, advancePendingToExtracted } from './transcribe-store';
export type { TranscribeView } from './transcribe-store';
