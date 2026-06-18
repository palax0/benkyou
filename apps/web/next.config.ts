import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Next only auto-loads .env from this app dir, but the single source-of-truth
// .env lives at the monorepo root (same file the worker/migrate scripts read via
// `tsx --env-file-if-exists`). Load it so @benkyou/core/config sees DATABASE_URL
// etc. In serverless/prod the vars are injected (e.g. compose), so it's optional.
const rootEnv = path.resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  serverExternalPackages: ['postgres'],
};

export default withNextIntl(nextConfig);
