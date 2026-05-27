export interface BatchResult {
  processed: number;
  errors: number;
}

export async function processBatch(maxJobs: number): Promise<BatchResult> {
  console.log(`[worker] processBatch(${maxJobs}) — M0 stub`);
  return { processed: 0, errors: 0 };
}
