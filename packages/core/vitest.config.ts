import { defineConfig } from 'vitest/config';
import { shouldUseSharedDatabase } from './test/db-harness/helpers';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    globalSetup: shouldUseSharedDatabase(process.argv.slice(2))
      ? ['./test/db-harness/global-setup.ts']
      : [],
    // The OOM hazard (one pgvector container per test file) is gone: globalSetup
    // now starts a single shared container and each suite clones a cheap database
    // from a migrated template. Keep worker count capped as a conservative
    // bound on concurrent connections/load against that one container on
    // memory-constrained WSL; clones are independent and DATABASE_URL is per-fork.
    fileParallelism: true,
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
