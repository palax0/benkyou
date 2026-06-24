import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const compose = readFileSync(resolve(import.meta.dirname, '../../../docker-compose.yml'), 'utf8');
const webDockerfile = readFileSync(resolve(import.meta.dirname, '../../../Dockerfile.web'), 'utf8');

function serviceBlock(service: string): string {
  const marker = `  ${service}:\n`;
  const start = compose.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = compose.slice(start + marker.length);
  const nextService = rest.search(/\n  [a-z][a-z0-9-]*:\n/);
  return nextService === -1 ? rest : rest.slice(0, nextService);
}

describe('docker compose PoToken wiring', () => {
  test('web and worker both see the sidecar URL used for status and extraction', () => {
    const expected = 'POTOKEN_PROVIDER_URL: http://potoken-provider:4416';

    expect(serviceBlock('web')).toContain(expected);
    expect(serviceBlock('worker')).toContain(expected);
  });

  test('sidecar stays internal to the compose network', () => {
    const sidecar = serviceBlock('potoken-provider');

    expect(sidecar).toContain('expose:');
    expect(sidecar).not.toContain('ports:');
  });

  test('web image starts Next from the app workspace dependencies', () => {
    expect(webDockerfile).toContain('CMD ["node", "./node_modules/next/dist/bin/next", "start"]');
  });
});
