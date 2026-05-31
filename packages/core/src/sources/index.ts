import type { SourceAdapter } from './types';
import { rssAdapter } from './rss';

const ADAPTERS = new Map<string, SourceAdapter>([[rssAdapter.type, rssAdapter]]);

export function getAdapter(type: string): SourceAdapter {
  const adapter = ADAPTERS.get(type);
  if (!adapter) throw new Error(`No source adapter registered for type: ${type}`);
  return adapter;
}

export type { RawItem, SourceAdapter } from './types';
