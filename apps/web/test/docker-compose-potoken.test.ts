import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const compose = readFileSync(resolve(import.meta.dirname, '../../../docker-compose.yml'), 'utf8');
const webDockerfile = readFileSync(resolve(import.meta.dirname, '../../../Dockerfile.web'), 'utf8');

describe('docker compose YouTube backend (SIDECAR=drop)', () => {
  test('PoToken sidecar is dropped: no service and no provider URL wiring', () => {
    // The yt-dlp migration (PR #20) reaches YouTube without a PoToken sidecar.
    // Lock the drop in so a sidecar can't silently creep back into compose.
    expect(compose).not.toContain('potoken-provider');
    expect(compose).not.toContain('POTOKEN_PROVIDER_URL');
  });

  test('web image starts Next from the app workspace dependencies', () => {
    expect(webDockerfile).toContain('CMD ["node", "./node_modules/next/dist/bin/next", "start"]');
  });
});
