import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// §6 SPIKE — the kill-switch. Validates yt-dlp can fetch metadata + captions (+ audio)
// for the known-blocked video BEFORE the migration is built. Off by default.
// Run WITH sidecar (publish 4416 locally first):
//   YTDLP_LIVE=1 POTOKEN_PROVIDER_URL=http://localhost:4416 \
//   pnpm --filter @benkyou/core test ytdlp-spike
// Run WITHOUT sidecar:
//   YTDLP_LIVE=1 pnpm --filter @benkyou/core test ytdlp-spike
const RUN = process.env.YTDLP_LIVE === '1';
const BLOCKED_ID = '7qO8-kx3gW8'; // §0: captions [zh-Hans, zh-Hant], blocked through youtubei.js
const URL = `https://www.youtube.com/watch?v=${BLOCKED_ID}`;
const POT = process.env.POTOKEN_PROVIDER_URL; // set → "with sidecar" column

function runYtdlp(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let stdout = ''; let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

// The pot plugin arg under test. Task 1 confirms the literal key → records POT_EXTRACTOR_ARG.
const potArgs = POT ? ['--extractor-args', `youtubepot-bgutilhttp:base_url=${POT}`] : [];

describe.skipIf(!RUN)('yt-dlp spike (§6 gate)', () => {
  test('Probe 1: metadata (-J) resolves title + duration', async () => {
    const r = await runYtdlp([...potArgs, '--no-playlist', '-J', '--skip-download', URL]);
    expect(r.code).toBe(0);
    const info = JSON.parse(r.stdout) as { title?: string; duration?: number };
    expect(typeof info.title).toBe('string');
    expect(typeof info.duration).toBe('number');
  }, 120_000);

  test('Probe 2: json3 captions (zh-Hans) download and parse', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spike-'));
    try {
      const r = await runYtdlp([
        ...potArgs, '--no-playlist', '--skip-download', '--write-subs', '--write-auto-subs',
        '--sub-langs', 'zh-Hans', '--sub-format', 'json3', '-o', join(dir, 'sub.%(ext)s'), URL,
      ]);
      expect(r.code).toBe(0);
      const files = await readdir(dir);
      const json3 = files.find((f) => f.endsWith('.json3'));
      expect(json3).toBeDefined();
      const parsed = JSON.parse(await readFile(join(dir, json3!), 'utf8')) as { events?: unknown[] };
      expect((parsed.events?.length ?? 0)).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test('Probe 3: bestaudio downloads a playable file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spike-'));
    try {
      const r = await runYtdlp([...potArgs, '--no-playlist', '-f', 'bestaudio', '-o', join(dir, 'audio.%(ext)s'), URL]);
      expect(r.code).toBe(0);
      const files = await readdir(dir);
      expect(files.some((f) => f.startsWith('audio.'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
