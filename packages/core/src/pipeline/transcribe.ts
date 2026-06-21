// Stub for B6 (transcribe engine). Implementation lands in Task B6.
// runner.ts imports this; tests mock it via vi.mock.
import type { TranscribeView } from './transcribe-store';
import type { TranscriptSegment } from '../sources/types';

export interface TranscribeResult {
  segments: TranscriptSegment[];
  flatText: string;
  durationSec: number;
}

export async function transcribeItem(_item: TranscribeView): Promise<TranscribeResult> {
  throw new Error('transcribeItem: not yet implemented (B6)');
}
