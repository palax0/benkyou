// Serverless batch handler delegates to the shared implementation in core.
// (/api/cron/work in apps/web calls the same core processBatch in M1b.)
export { processBatch, type BatchResult } from '@benkyou/core/queue';
