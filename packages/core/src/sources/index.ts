// Importing resolve triggers adapter registration (rss, article, youtube, bilibili)
// via the side-effectful registerAdapter calls at module load time in resolve.ts.
import { getAdapter } from './registry';
import { resolveAdapter, detectAdhocType, detectAdhocMedia } from './resolve';

export { getAdapter, resolveAdapter, detectAdhocType, detectAdhocMedia };
export type { RawItem, SourceAdapter } from './types';
export * from './manage';
export { SOURCE_TYPE_CATALOG } from './catalog';
export type { SourceTypeInfo, SourceTypeStatus } from './catalog';
export { generateBilibiliQr, pollBilibiliQr } from './bilibili-qr';
export type { QrGenerate, QrPollStatus, QrPollResult } from './bilibili-qr';
export { getPlatformCredential, getBilibiliSessdata } from './platform-credentials';
export type { Platform, PlatformCredentialRow } from './platform-credentials';
