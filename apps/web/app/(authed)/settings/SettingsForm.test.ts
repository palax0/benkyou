import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

// SettingsForm was split into sections/AiServicesSection.tsx (the AI services section that
// still uses updateSettingsAction and enforces the secret boundary).
const dir = path.resolve(import.meta.dirname);

describe('settings form secret boundary', () => {
  test('client form does not read stored provider API keys', async () => {
    const source = await readFile(path.join(dir, 'sections/AiServicesSection.tsx'), 'utf8');

    expect(source).not.toMatch(/settings\.llmApiKey(?!Configured)/);
    expect(source).not.toMatch(/settings\.embedApiKey(?!Configured)/);
    expect(source).toContain('llmApiKeyConfigured');
    expect(source).toContain('embedApiKeyConfigured');
  });

  test('settings page strips raw provider API keys before passing props to the client form', async () => {
    const source = await readFile(path.join(dir, 'page.tsx'), 'utf8');

    expect(source).toContain('const { llmApiKey, embedApiKey, readerApiKey, ...safeSettings } = settings;');
    expect(source).toContain('llmApiKeyConfigured: Boolean(llmApiKey)');
    expect(source).toContain('embedApiKeyConfigured: Boolean(embedApiKey)');
    expect(source).not.toContain('<SettingsForm settings={settings}');
    expect(source).toContain('readerApiKeyConfigured: Boolean(readerApiKey)');
  });

  test('client form does not read the stored reader API key, and renders the reader section', async () => {
    const source = await readFile(path.join(dir, 'sections/AiServicesSection.tsx'), 'utf8');
    expect(source).not.toMatch(/settings\.readerApiKey(?!Configured)/);
    expect(source).toContain('readerApiKeyConfigured');
    expect(source).toContain("name=\"readerBaseUrl\"");
  });
});
