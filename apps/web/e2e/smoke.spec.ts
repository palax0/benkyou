import { test, expect } from '@playwright/test';

test('GET /health returns ok', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { status: string; db: boolean };
  expect(body.status).toBe('ok');
  expect(body.db).toBe(true);
});

test('home redirects unauthenticated users to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
