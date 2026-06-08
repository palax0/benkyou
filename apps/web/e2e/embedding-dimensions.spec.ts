import { test, expect, type Page } from '@playwright/test';

// Provider config pointed at the mock (see playwright.config.ts webServer[0]).
// 'openai-compatible' keeps the request/response shapes plain so the mock stays
// simple; the feature's per-provider key mapping is unit-covered elsewhere.
const MOCK_BASE_URL = 'http://localhost:4599/v1';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="password"]', 'e2e-password');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/login/);
}

async function fillMockProvider(page: Page): Promise<void> {
  await page.fill('input[name="llmProvider"]', 'openai-compatible');
  await page.fill('input[name="llmBaseUrl"]', MOCK_BASE_URL);
  await page.fill('input[name="llmApiKey"]', 'test-key');
  await page.fill('input[name="llmModel"]', 'mock-llm');
  await page.fill('input[name="embedProvider"]', 'openai-compatible');
  await page.fill('input[name="embedBaseUrl"]', MOCK_BASE_URL);
  await page.fill('input[name="embedApiKey"]', 'test-key');
  await page.fill('input[name="embedModel"]', 'mock-embed-3072');
}

test.describe('settings: request output dimensions toggle', () => {
  test('off → dim-mismatch smart error; on → truncates, saves, persists', async ({ page, context }) => {
    // Force English so message assertions are stable (locale is a next-intl cookie, default zh).
    await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);
    await login(page);

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Toggle + help render with the frozen dim interpolated.
    const toggle = page.locator('input[name="embedRequestDimensions"]');
    await expect(toggle).toBeVisible();
    await expect(page.getByText('Request output dimensions (truncate to 1536)')).toBeVisible();
    await expect(page.getByText(/check this to request 1536-dim vectors/i)).toBeVisible();

    await fillMockProvider(page);

    // Case A — toggle OFF: no dimensions requested, mock returns its native 3072,
    // so the connectivity test fails with the smart dim-mismatch error.
    await expect(toggle).not.toBeChecked();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Embedding dim 3072 != frozen 1536/)).toBeVisible();

    // Case B — toggle ON: requests dimensions=1536, mock truncates to 1536,
    // connectivity test passes and the form saves.
    // A React 19 `<form action>` auto-resets its uncontrolled fields after each
    // submission, so the provider config (reverted to seeded defaults by Case A's
    // submit) must be re-entered before saving again.
    await fillMockProvider(page);
    await toggle.check();
    await expect(toggle).toBeChecked();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    // Persistence: the stored value survives a full reload (defaultChecked from DB).
    await page.reload();
    await expect(page.locator('input[name="embedRequestDimensions"]')).toBeChecked();
  });
});
