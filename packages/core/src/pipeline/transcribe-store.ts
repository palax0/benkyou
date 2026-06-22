import { and, eq, sql } from 'drizzle-orm';
import { getDbClient, items } from '../db';
import type { TranscriptSegment, TranscriptStatus } from '../sources/types';

export interface TranscribeView {
  id: string; state: string; transcriptStatus: string;
  mediaUrl: string | null; url: string; durationSec: number | null; isAdhoc: boolean;
}

export async function getTranscribeView(itemId: string): Promise<TranscribeView | undefined> {
  const db = getDbClient();
  const rows = await db
    .select({
      id: items.id, state: items.state, transcriptStatus: items.transcriptStatus,
      mediaUrl: items.mediaUrl, url: items.url, durationSec: items.videoDuration, sourceId: items.sourceId,
    })
    .from(items).where(eq(items.id, itemId)).limit(1);
  const r = rows[0];
  if (!r) return undefined;
  return { ...r, isAdhoc: r.sourceId == null };
}

export async function setTranscriptStatus(itemId: string, status: TranscriptStatus): Promise<void> {
  const db = getDbClient();
  await db.update(items).set({ transcriptStatus: status, updatedAt: sql`now()` }).where(eq(items.id, itemId));
}

// Both transcribe terminal paths (success / dead-letter degrade) write the finalized
// transcript_status AND the state advance in ONE guarded UPDATE. Splitting them left a
// window where transcript_status was 'present'/'unavailable' while the row was still
// parked at current_stage='extract'; orphan recovery (retryItem re-runs current_stage)
// would then re-enter extract, where isTranscribeEligible=false routes the raw media URL
// through the ARTICLE adapter and clobbers raw_content. Folding both columns into the
// same statement means there is never such a row. This is also the ONLY place
// current_stage leaves 'extract' for a transcribed item (decision #7).
//
// Guard on state='pending' makes a redelivered success — or a dead-letter that fires
// after a successful delivery already advanced — a no-op (returns false → no embed
// enqueue), and stops the dead-letter from overwriting a good 'present' with 'unavailable'.
// Mirrors completeStage's reset of attempts/error.

export async function writeTranscriptAndAdvance(
  itemId: string, data: { segments: TranscriptSegment[]; flatText: string; durationSec: number },
): Promise<boolean> {
  const db = getDbClient();
  const rows = await db.update(items).set({
    transcriptStatus: 'present',
    transcriptSegments: data.segments,
    rawContent: data.flatText,
    videoDuration: data.durationSec,
    state: 'extracted', currentStage: 'embed', attempts: 0, lastError: null,
    updatedAt: sql`now()`,
  }).where(and(eq(items.id, itemId), eq(items.state, 'pending'))).returning({ id: items.id });
  return rows.length > 0;
}

export async function degradeTranscriptAndAdvance(itemId: string): Promise<boolean> {
  const db = getDbClient();
  const rows = await db.update(items).set({
    transcriptStatus: 'unavailable', // raw_content stays title/show-notes only
    state: 'extracted', currentStage: 'embed', attempts: 0, lastError: null,
    updatedAt: sql`now()`,
  }).where(and(eq(items.id, itemId), eq(items.state, 'pending'))).returning({ id: items.id });
  return rows.length > 0;
}
