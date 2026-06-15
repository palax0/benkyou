import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

describe('getItemForUser projection', () => {
  test('selects content_md and extract_status', async () => {
    const src = await readFile(
      path.resolve(import.meta.dirname, '../../src/items/queries.ts'),
      'utf8',
    );
    expect(src).toContain('contentMd: items.contentMd');
    expect(src).toContain('extractStatus: items.extractStatus');
  });
});
