import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou_e2e';
const FAILED_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

test.beforeAll(async () => {
  const sql = postgres(DATABASE_URL);
  try {
    await sql`INSERT INTO items (id, url, url_hash, title, content_type, state, current_stage, attempts, last_error)
      VALUES (${FAILED_ID}, 'https://x/failed', 'failedhash', 'Failed Item', 'article', 'failed', 'embed', 3, 'boom: provider down')
      ON CONFLICT (id) DO UPDATE SET state='failed', current_stage='embed', attempts=3, last_error='boom: provider down'`;
  } finally {
    await sql.end();
  }
});

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="password"]', 'e2e-password');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/login/);
}

test('failure triage: panel shows error → retry restores', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);
  await login(page);
  await page.goto('/admin/jobs');
  await expect(page.getByText('Failed Item')).toBeVisible();
  await page.getByText('Last error').click();
  await expect(page.getByText('boom: provider down')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).first().click();
  // Retry resets the item to its pre-stage state ('extracted') and re-enqueues, so
  // it leaves the failed list but reappears in-flight (same title) until a worker
  // drains it — scope the assertion to the failed section.
  await expect(page.locator('#failed').getByText('Failed Item')).toBeHidden();
});
