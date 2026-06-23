import { env } from '../config/env';
import { getPlatformCredential, type PlatformCredentialRow } from './platform-credentials';

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
    // YouTube auto-refreshes; "off" only when the capability is disabled. Persistent
    // sidecar failure is surfaced separately in the health panel (Task 9), not here.
    youtube: env.POTOKEN_PROVIDER_URL ? 'auto' : 'off',
  };
}
