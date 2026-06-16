import { defineConfig } from 'vitest/config';

const dbBackedTestPatterns = ['.int.test.ts', 'test/db.test.ts', 'test/boss.test.ts'];

function shouldUseSharedDatabase(args: readonly string[]): boolean {
  const filters = args.filter((arg) => !arg.startsWith('-') && arg !== 'run');
  if (filters.length === 0) return true;
  return filters.some((arg) =>
    dbBackedTestPatterns.some((pattern) => arg.includes(pattern)),
  );
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    globalSetup: shouldUseSharedDatabase(process.argv.slice(2))
      ? ['./test/db-harness/global-setup.ts']
      : [],
    // Integration suites each create a pgvector Testcontainers database. Running
    // files serially keeps local WSL/Docker memory use bounded.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
