import { getDbClient, aiUsage } from '../db';

export interface UsageContext {
  stage: string;
  itemId?: string | null;
}

export interface UsageFields {
  kind: 'llm' | 'embedding';
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

function finiteOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Best-effort token ledger write (spec §7): a failure here is logged and
 * swallowed — it must never break the pipeline stage that produced the usage.
 */
export async function recordUsage(ctx: UsageContext, fields: UsageFields): Promise<void> {
  try {
    const db = getDbClient();
    await db.insert(aiUsage).values({
      itemId: ctx.itemId ?? null,
      stage: ctx.stage,
      kind: fields.kind,
      model: fields.model,
      inputTokens: finiteOrNull(fields.inputTokens),
      outputTokens: finiteOrNull(fields.outputTokens),
      totalTokens: finiteOrNull(fields.totalTokens),
    });
  } catch (err) {
    console.error('[ai_usage] record failed:', err instanceof Error ? err.message : err);
  }
}
