import { eq } from 'drizzle-orm';
import { getDbClient, items, sources } from '../db';
import { resolveAdapter } from '../sources';
import { getUserSettings } from '../settings';
import type { ExtractResult } from '../sources/types';
import { env } from '../config/env';
import { transcribePolicy } from './transcribe-policy';
import { probeRemoteDurationSec } from './media-probe';
import { setTranscriptStatus } from './transcribe-store';
import { getBoss, enqueueTranscribe } from '../queue';
import { getBilibiliSessdata } from '../sources/platform-credentials';
import { parseYoutubeVideoId } from '../sources/youtube';
import { isYoutubeBackendEnabled, isYoutubeAudioEnabled } from '../sources/ytdlp';
import type { StageOutcome } from './state';

// A media item is transcribe-eligible when it carries a downloadable audio/video source
// and has no usable transcript yet. The article adapter would mangle a raw media URL, so
// these items SKIP the adapter entirely (clarifies the spec's "after the adapter returns":
// podcasts keep their ingest-time show-notes raw_content, paste has none).
function isTranscribeEligible(item: { contentType: string; mediaUrl: string | null; transcriptStatus: string }): boolean {
  return (item.contentType === 'audio' || item.contentType === 'video')
    && item.mediaUrl != null
    && item.transcriptStatus !== 'present';
}

// Decision tail shared by the pre-adapter media handoff (duration probed) and the
// post-adapter YouTube→Whisper handoff (duration already known from getInfo, §4.2).
export async function applyTranscribePolicy(
  item: { id: string; sourceId: string | null },
  durationSec: number,
): Promise<StageOutcome> {
  const settings = await getUserSettings();
  const decision = transcribePolicy({
    durationSec, isAdhoc: item.sourceId == null,
    deployMode: env.DEPLOY_MODE === 'serverless' ? 'serverless' : 'docker',
    autoLimit: settings?.videoAutoLimit ?? 1800,
    manualLimit: settings?.videoManualLimit ?? 10800,
  });
  if (decision.kind === 'skip') {
    await setTranscriptStatus(item.id, decision.status);
    return { advance: true };
  }
  if (decision.kind === 'confirm') {
    await setTranscriptStatus(item.id, 'needs_confirmation'); // parks; orphan check excludes it
    return { advance: false };
  }
  await setTranscriptStatus(item.id, 'pending');
  const boss = await getBoss();
  await enqueueTranscribe(boss, item.id, { durationSec });
  return { advance: false }; // transcribe owns the next advance
}

async function runMediaHandoff(item: {
  id: string; url: string; mediaUrl: string | null; videoDuration: number | null; sourceId: string | null;
}): Promise<StageOutcome> {
  const source = item.mediaUrl ?? item.url;
  let durationSec = item.videoDuration;
  if (durationSec == null) {
    const probed = await probeRemoteDurationSec(source); // throws transient → extract retry consumes attempts
    if (probed == null) {                                // resolved but not media → degrade + continue
      await setTranscriptStatus(item.id, 'unavailable');
      return { advance: true };
    }
    durationSec = probed;
    await getDbClient().update(items).set({ videoDuration: durationSec }).where(eq(items.id, item.id));
  }
  return applyTranscribePolicy(item, durationSec);
}

// Post-adapter Layer-2 seam (§4.2). The video_duration != null guard is LOAD-BEARING:
// it keeps a no-duration result degrading to 'unavailable' (never ffprobing the watch
// page HTML). Bilibili is excluded — parseYoutubeVideoId returns null for it.
export function isYoutubeWhisperHandoff(
  item: { contentType: string; transcriptStatus: string; url: string; videoDuration: number | null },
  audioHandoffEnabled: boolean,
): boolean {
  return item.contentType === 'video'
    && item.transcriptStatus === 'unavailable'
    && audioHandoffEnabled
    && item.videoDuration != null
    && parseYoutubeVideoId(item.url) != null;
}

// A paste item starts with title = its URL (placeholder). extract refines it from the
// adapter's discovered title, but ONLY over that placeholder — a real feed title (RSS)
// must never be clobbered by a possibly-worse extracted title.
export function resolveTitle(existingTitle: string, url: string, discovered?: string | null): string {
  const isPlaceholder = existingTitle.length === 0 || existingTitle === url;
  const next = discovered?.trim();
  return isPlaceholder && next ? next : existingTitle;
}

// Pure mapping from adapter result → items column patch. Dispatcher defaults
// contentMd=null and extractStatus='ok' (parallels transcriptStatus default).
export function extractColumns(
  result: ExtractResult,
  existing: { videoKind: string | null; title: string; url: string },
) {
  return {
    rawContent: result.rawContent,
    title: resolveTitle(existing.title, existing.url, result.title),
    contentMd: result.contentMd ?? null,
    extractStatus: result.extractStatus ?? 'ok',
    contentType: result.contentType,
    transcriptStatus: result.transcriptStatus ?? 'na',
    transcriptSegments: result.transcriptSegments ?? null,
    videoDuration: result.videoDuration ?? null,
    // M2a does not classify videoKind; preserve any existing value.
    videoKind: result.videoKind ?? existing.videoKind ?? null,
  };
}

export async function extractItem(itemId: string): Promise<StageOutcome | void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  if (isTranscribeEligible(item)) {
    return runMediaHandoff(item);
  }

  let type: string | null = null;
  let config: Record<string, unknown> | undefined;
  if (item.sourceId) {
    const srcRows = await db
      .select({ type: sources.type, config: sources.config })
      .from(sources)
      .where(eq(sources.id, item.sourceId))
      .limit(1);
    type = srcRows[0]?.type ?? null;
    config = srcRows[0]?.config as Record<string, unknown> | undefined;
  }

  // Reader fallback is enabled only when reader_base_url is set (design §5).
  const settings = await getUserSettings();
  const reader = settings?.readerBaseUrl
    ? { baseUrl: settings.readerBaseUrl, apiKey: settings.readerApiKey ?? undefined }
    : undefined;

  const adapter = resolveAdapter({ type, url: item.url });
  const bilibiliSessdata = (await getBilibiliSessdata()) ?? undefined;
  const result = await adapter.extract({
    url: item.url,
    rawContent: item.rawContent,
    externalId: item.externalId,
    config,
    reader,
    credentials: { bilibiliSessdata },
  });

  await db
    .update(items)
    .set(extractColumns(result, { videoKind: item.videoKind, title: item.title, url: item.url }))
    .where(eq(items.id, itemId));

  if (isYoutubeWhisperHandoff(
    {
      contentType: result.contentType,
      transcriptStatus: result.transcriptStatus ?? 'na',
      url: item.url,
      videoDuration: result.videoDuration ?? null,
    },
    isYoutubeBackendEnabled() && isYoutubeAudioEnabled(),
  )) {
    // Overwrite the just-written 'unavailable' with pending/needs_confirmation/skipped_*.
    return applyTranscribePolicy({ id: itemId, sourceId: item.sourceId }, result.videoDuration!);
  }
}
