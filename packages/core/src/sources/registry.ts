import type { SourceAdapter } from './types';

const ADAPTERS = new Map<string, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  ADAPTERS.set(adapter.type, adapter);
}

export function getAdapter(type: string): SourceAdapter {
  const adapter = ADAPTERS.get(type);
  if (!adapter) throw new Error(`No source adapter registered for type: ${type}`);
  return adapter;
}
