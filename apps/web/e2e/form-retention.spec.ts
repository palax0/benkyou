import { test, expect, type Page } from '@playwright/test';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="password"]', 'e2e-password');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/login/);
}

test('settings: invalid submit keeps entered values', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);
  await login(page);
  await page.goto('/settings');
  // Unreachable base url → connectivity test fails.
  await page.fill('input[name="llmProvider"]', 'openai-compatible');
  await page.fill('input[name="llmBaseUrl"]', 'http://localhost:1/v1');
  await page.fill('input[name="llmModel"]', 'my-typed-model');
  await page.fill('input[name="embedModel"]', 'my-typed-embed');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('input[name="llmModel"]')).toHaveValue('my-typed-model');
  await expect(page.locator('input[name="embedModel"]')).toHaveValue('my-typed-embed');
});
