import { defineConfig } from '@playwright/test';

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
  },
  webServer: {
    command: 'pnpm --filter @benkyou/web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL,
      EMBED_DIM: '1536',
      SESSION_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      DEPLOY_MODE: 'docker',
    },
  },
});
