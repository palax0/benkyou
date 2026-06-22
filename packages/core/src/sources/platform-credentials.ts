import { eq, sql } from 'drizzle-orm';
import { getDbClient, platformCredentials } from '../db';

export type Platform = 'youtube' | 'bilibili';

export interface PlatformCredentialRow {
  secret: string | null;
  meta: Record<string, unknown> | null;
  updatedAt: Date;
}

export async function getPlatformCredential(platform: Platform): Promise<PlatformCredentialRow | null> {
  const db = getDbClient();
  const rows = await db
    .select({ secret: platformCredentials.secret, meta: platformCredentials.meta, updatedAt: platformCredentials.updatedAt })
    .from(platformCredentials)
    .where(eq(platformCredentials.platform, platform))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { secret: r.secret, meta: (r.meta as Record<string, unknown> | null) ?? null, updatedAt: r.updatedAt };
}

// Upsert. A field absent from `data` is left untouched (COALESCE on conflict) so callers
// can update just the secret without clobbering meta (and vice-versa).
export async function upsertPlatformCredential(
  platform: Platform,
  data: { secret?: string | null; meta?: Record<string, unknown> | null },
): Promise<void> {
  const db = getDbClient();
  const secret = data.secret ?? null;
  const meta = data.meta ?? null;
  await db
    .insert(platformCredentials)
    .values({ platform, secret, meta, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: platformCredentials.platform,
      set: {
        secret: data.secret === undefined ? sql`${platformCredentials.secret}` : secret,
        meta: data.meta === undefined ? sql`${platformCredentials.meta}` : meta,
        updatedAt: sql`now()`,
      },
    });
}

export async function getBilibiliSessdata(): Promise<string | null> {
  return (await getPlatformCredential('bilibili'))?.secret ?? null;
}
