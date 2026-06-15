import { test, expect } from '@playwright/test';

test.describe('URL paste', () => {
  test.beforeEach(async ({ page, context }) => {
    // Force English UI so assertions are stable (locale is a next-intl cookie, default zh).
    await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);

    // Unauthenticated → redirected to /login by middleware.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);

    // Correct password → home feed with PasteForm visible.
    await page.fill('input[name="password"]', 'e2e-password');
    await page.click('button[type="submit"]');
    await expect(page.getByPlaceholder(/Paste|粘贴/)).toBeVisible();
  });

  test('pasting an article URL navigates to its item and shows the progress view', async ({ page }) => {
    await page.getByPlaceholder(/Paste|粘贴/).fill('https://example.com/e2e-article');
    await page.getByRole('button', { name: /^Add$|^添加$/ }).click();

    // API creates the item and redirects to /items/<uuid>.
    await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);

    // No worker in e2e → item stays pending → the progress view is shown
    // (h1 = "Processing…", body paragraph = "Current stage: …").
    await expect(page.getByText(/Processing…|正在处理/)).toBeVisible();
    await expect(page.getByText(/Current stage|当前阶段/)).toBeVisible();
  });

  test('pasting a duplicate URL jumps to the existing item', async ({ page }) => {
    // First paste — creates the item.
    await page.getByPlaceholder(/Paste|粘贴/).fill('https://example.com/e2e-dup');
    await page.getByRole('button', { name: /^Add$|^添加$/ }).click();
    await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
    const firstUrl = page.url();

    // Go back to feed.
    await page.goto('/');
    await expect(page.getByPlaceholder(/Paste|粘贴/)).toBeVisible();

    // Second paste — same canonical URL (utm_* stripped by url_hash) → jumps to same item.
    await page.getByPlaceholder(/Paste|粘贴/).fill('https://example.com/e2e-dup?utm_source=x');
    await page.getByRole('button', { name: /^Add$|^添加$/ }).click();
    await expect(page).toHaveURL(firstUrl); // same id — dup-jump
  });
});
