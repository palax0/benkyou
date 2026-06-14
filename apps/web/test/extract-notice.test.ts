import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const file = path.resolve(import.meta.dirname, '../components/ExtractNotice.tsx');

describe('ExtractNotice', () => {
  test('uses the pure decision helper and links to the original', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toContain('extractNoticeState');
    expect(src).toContain("t('original')"); // renders the "Original" link via the shared i18n key
    expect(src).toContain('href={url}'); // links to the source url prop
  });

  test('renders both missing and partial copy, and the title-only summary badge', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toContain('extractMissing');
    expect(src).toContain('extractPartial');
    expect(src).toContain('summaryTitleOnly');
  });

  test('no improvised visual values', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(src).not.toMatch(/\b(?:p|m|gap|text|bg)-\[/);
    expect(src).not.toMatch(/style=\{/);
  });
});
