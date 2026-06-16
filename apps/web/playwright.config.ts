import { defineConfig } from '@playwright/test';

// Dedicated e2e database — global-setup TRUNCATEs every run, so it must never
// point at the dev DB (`…/benkyou`). Override with E2E_DATABASE_URL in CI.
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou_e2e';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Spec files share one e2e database, so they must run serially: sources.spec
  // flips embed_request_dimensions while embedding-dimensions.spec asserts its
  // default. That ordering relies on alphabetical file order under workers: 1.
  workers: 1,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
  },
  webServer: [
    {
      // OpenAI-compatible mock provider for the settings connectivity test
      // (server-side call → needs a real listener, not a browser interceptor).
      command: 'pnpm exec tsx e2e/provider-mock-server.ts',
      url: 'http://localhost:4599/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { PROVIDER_MOCK_PORT: '4599' },
    },
    {
      // Mock RSS feed so the sources e2e flow can ingest a source offline.
      command: 'pnpm exec tsx e2e/rss-mock-server.ts',
      url: 'http://localhost:4699/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { RSS_MOCK_PORT: '4699' },
    },
    {
      command: 'pnpm --filter @benkyou/web dev',
      // Probe /health rather than /: it returns 200 even when its DB check fails,
      // and Playwright starts webServer entries before globalSetup, so the e2e
      // database may not exist yet at probe time.
      url: 'http://localhost:3000/health',
      // Do not reuse a developer-run Next server: it may be connected to the
      // dev database instead of the isolated e2e database below.
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL,
        EMBED_DIM: '1536',
        SESSION_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        DEPLOY_MODE: 'docker',
      },
    },
  ],
});
