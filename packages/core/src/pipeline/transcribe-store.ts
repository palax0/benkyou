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

export async function writeTranscript(
  itemId: string, data: { segments: TranscriptSegment[]; flatText: string; durationSec: number },
): Promise<void> {
  const db = getDbClient();
  await db.update(items).set({
    transcriptStatus: 'present',
    transcriptSegments: data.segments,
    rawContent: data.flatText,
    videoDuration: data.durationSec,
    updatedAt: sql`now()`,
  }).where(eq(items.id, itemId));
}

export async function setTranscriptStatus(itemId: string, status: TranscriptStatus): Promise<void> {
  const db = getDbClient();
  await db.update(items).set({ transcriptStatus: status, updatedAt: sql`now()` }).where(eq(items.id, itemId));
}

// Conditional advance guarded on state='pending' so a redelivered success OR a
// dead-letter re-run is a no-op. This is the ONLY place current_stage leaves 'extract'
// for a transcribed item (decision #7). Mirrors completeStage's reset of attempts/error.
export async function advancePendingToExtracted(itemId: string): Promise<boolean> {
  const db = getDbClient();
  const rows = await db.update(items).set({
    state: 'extracted', currentStage: 'embed', attempts: 0, lastError: null, updatedAt: sql`now()`,
  }).where(and(eq(items.id, itemId), eq(items.state, 'pending'))).returning({ id: items.id });
  return rows.length > 0;
}
