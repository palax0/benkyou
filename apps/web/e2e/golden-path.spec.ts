import { test, expect } from '@playwright/test';

test('golden path: gate → login → feed → detail → logout', async ({ page, context }) => {
  // Force English UI so assertions are stable (locale is a next-intl cookie, default zh).
  await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);

  // Unauthenticated → redirected to /login by middleware.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);

  // Wrong password → error.
  await page.fill('input[name="password"]', 'nope');
  await page.click('button[type="submit"]');
  await expect(page.getByText(/wrong password/i)).toBeVisible();

  // Correct password → home feed with the seeded item.
  await page.fill('input[name="password"]', 'e2e-password');
  await page.click('button[type="submit"]');
  await expect(page.getByRole('link', { name: 'Seeded Article' })).toBeVisible();

  // Detail page shows cached deep summary + body (no LLM call).
  await page.getByRole('link', { name: 'Seeded Article' }).click();
  await expect(page.getByRole('heading', { name: 'Seeded Article' })).toBeVisible();
  await expect(page.getByText('TL;DR seeded deep summary.')).toBeVisible();
  await expect(page.getByText('Full seeded body content.')).toBeVisible();

  // Logout → back to /login.
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
});
