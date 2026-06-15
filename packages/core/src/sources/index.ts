// Importing resolve triggers adapter registration (rss, article, youtube, bilibili)
// via the side-effectful registerAdapter calls at module load time in resolve.ts.
import { getAdapter } from './registry';
import { resolveAdapter, detectAdhocType } from './resolve';

export { getAdapter, resolveAdapter, detectAdhocType };
export type { RawItem, SourceAdapter } from './types';
export * from './manage';
