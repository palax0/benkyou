// Drives the /sources page IA (spec §2.2): one block per entry, rendered from this
// catalog — never hardcoded. 'article' is intentionally absent: it is adhoc-only
// (paste), surfaced as the separate manual-import card, not a source-type block.
export type SourceTypeStatus = 'implemented' | 'planned';

export interface SourceTypeInfo {
  type: string;
  status: SourceTypeStatus;
  milestone?: string; // planned types only
}

export const SOURCE_TYPE_CATALOG: readonly SourceTypeInfo[] = [
  { type: 'rss', status: 'implemented' },
  { type: 'youtube', status: 'planned', milestone: 'M2a' },
  { type: 'bilibili', status: 'planned', milestone: 'M2a' },
  { type: 'hn', status: 'planned', milestone: 'v2' },
  { type: 'reddit', status: 'planned', milestone: 'v2' },
];
