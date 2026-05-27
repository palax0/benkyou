export async function runLoop(): Promise<void> {
  console.log('[worker] long-running loop started; awaiting jobs (M0 stub)');
  // M1 will plug in pg-boss handlers
  return new Promise(() => {
    // Intentional never-resolve; SIGTERM kills it
  });
}
