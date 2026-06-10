import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { getDbClient, sessions } from '../db';

const SLIDING_MS = 30 * 24 * 60 * 60 * 1000; // 30d sliding expiry
const ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000; // 90d hard cap (spec §10.2)

export function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(meta: {
  ip?: string;
  userAgent?: string;
}): Promise<{ id: string; expiresAt: Date }> {
  const db = getDbClient();
  const id = generateSessionId();
  const expiresAt = new Date(Date.now() + SLIDING_MS);
  await db.insert(sessions).values({
    id,
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return { id, expiresAt };
}

export interface SessionValidation {
  valid: boolean;
  expiresAt?: Date;
}

// Slides expiry forward and returns the refreshed expiry for cookie renewal;
// invalidates missing, expired, or absolute-cap sessions.
export async function validateSession(id: string): Promise<SessionValidation> {
  const db = getDbClient();
  const now = new Date();
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1);
  const session = rows[0];
  if (!session) return { valid: false };

  if (session.createdAt && now.getTime() - session.createdAt.getTime() > ABSOLUTE_MS) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return { valid: false };
  }

  const expiresAt = new Date(now.getTime() + SLIDING_MS);
  await db
    .update(sessions)
    .set({ lastUsedAt: now, expiresAt })
    .where(eq(sessions.id, id));
  return { valid: true, expiresAt };
}

export async function destroySession(id: string): Promise<void> {
  const db = getDbClient();
  await db.delete(sessions).where(eq(sessions.id, id));
}
