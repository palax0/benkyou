import { getPlatformCredential, type PlatformCredentialRow } from './platform-credentials';
import { isYoutubeBackendEnabled } from './ytdlp';

export interface CredentialStatus {
  bilibili: 'valid' | 'expired' | 'unset';
  youtube: 'off' | 'auto';
}

export function deriveBilibiliStatus(
  row: Pick<PlatformCredentialRow, 'secret' | 'meta'> | null,
  now: number,
): 'valid' | 'expired' | 'unset' {
  if (!row?.secret) return 'unset';
  const expiresAt = (row.meta as { expiresAt?: number } | null)?.expiresAt;
  if (typeof expiresAt === 'number' && expiresAt <= now) return 'expired';
  return 'valid';
}

export async function getCredentialStatus(): Promise<CredentialStatus> {
  const bili = await getPlatformCredential('bilibili');
  return {
    bilibili: deriveBilibiliStatus(bili, Date.now()),
    // SIDECAR=drop: the yt-dlp backend reflects docker capability, not sidecar presence
    // (spec §8). "off" only when the backend is disabled (serverless has no subprocess).
    youtube: isYoutubeBackendEnabled() ? 'auto' : 'off',
  };
}
