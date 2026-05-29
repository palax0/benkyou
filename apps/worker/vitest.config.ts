import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // Worker core (loop dispatcher, pipeline handlers) is hand-written later;
    // until those land there are no test files, and vitest 4 fails on an empty
    // set by default. Remove this once the worker has real tests.
    passWithNoTests: true,
  },
});
