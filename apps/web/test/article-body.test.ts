import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const file = path.resolve(import.meta.dirname, '../components/ArticleBody.tsx');

describe('ArticleBody', () => {
  test('renders markdown via react-markdown with sanitize + gfm', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toContain("from 'react-markdown'");
    expect(src).toContain("from 'rehype-sanitize'");
    expect(src).toContain("from 'remark-gfm'");
  });

  test('falls back to raw_content when content_md absent', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toContain('whitespace-pre-wrap'); // flat fallback path preserved
    expect(src).toContain('rawContent');
  });

  test('marks the prose-token gap and uses no improvised visual values', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toContain('DESIGN-GAP');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/); // no raw hex
    expect(src).not.toMatch(/\b(?:p|m|gap|text|bg)-\[/); // no Tailwind arbitrary values
    expect(src).not.toMatch(/style=\{/); // no inline style
  });
});
