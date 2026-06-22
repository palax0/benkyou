import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import zh from '../messages/zh.json';
import en from '../messages/en.json';

const file = path.resolve(import.meta.dirname, '../components/TranscriptBadge.tsx');

describe('TranscriptBadge', () => {
  test('needs_confirmation is an explicit Known case, not folded to pending', async () => {
    const src = await readFile(file, 'utf8');
    // listed in the STATUS map (a distinct treatment) and admitted by the `known` narrowing
    expect(src).toMatch(/needs_confirmation:\s*'text-/);
    expect(src).toContain("status === 'needs_confirmation'");
  });
  test('needs_confirmation has a calm, non-pulsing dot (waits on the user, not working)', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toMatch(/needs_confirmation:\s*'bg-[^']*'/);
    expect(src).not.toMatch(/needs_confirmation:\s*'bg-[^']*animate-pulse/);
  });
  test('zh + en both carry the needs_confirmation label', () => {
    expect(zh.item.transcript.needs_confirmation).toBeTruthy();
    expect(en.item.transcript.needs_confirmation).toBeTruthy();
  });
});
