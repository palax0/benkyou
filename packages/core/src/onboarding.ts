import { eq, sql } from 'drizzle-orm';
import { getDbClient, items, sources } from './db';
import { getUserSettings, isAiConfigured } from './settings';

// Onboarding completion is derived from real state (spec §4.3): provider config,
// source count, item count, first-done. No onboarding table/column. "Dismissed"
// is a client-only localStorage flag — not persisted here.
export interface OnboardingState {
  aiConfigured: boolean;
  hasSource: boolean;
  hasItem: boolean;
  hasDone: boolean;
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const db = getDbClient();
  const settings = await getUserSettings();
  const srcRows = await db.select({ c: sql<number>`count(*)::int` }).from(sources);
  const itemRows = await db.select({ c: sql<number>`count(*)::int` }).from(items);
  const doneRows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(items)
    .where(eq(items.state, 'done'));
  return {
    aiConfigured: settings ? isAiConfigured(settings) : false,
    hasSource: (srcRows[0]?.c ?? 0) > 0,
    hasItem: (itemRows[0]?.c ?? 0) > 0,
    hasDone: (doneRows[0]?.c ?? 0) > 0,
  };
}
