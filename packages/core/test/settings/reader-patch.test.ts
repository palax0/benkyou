import { describe, expect, test } from 'vitest';
import type { SettingsPatch } from '../../src/settings/index.js';

// Type-level guard: SettingsPatch must accept reader fields (compile-time contract).
describe('SettingsPatch reader fields', () => {
  test('accepts readerBaseUrl / readerApiKey (incl. null to clear)', () => {
    const patch: SettingsPatch = { readerBaseUrl: 'https://r.test', readerApiKey: null };
    expect(patch.readerBaseUrl).toBe('https://r.test');
    expect(patch.readerApiKey).toBeNull();
  });
});
