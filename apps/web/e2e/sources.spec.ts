import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';

const RSS_URL = 'http://localhost:4699/feed.xml';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou_e2e';

test.beforeAll(async () => {
  // The pipeline embed stage needs the mock's 3072-native vectors truncated to
  // the frozen 1536, which requires request-dimensions on. global-setup leaves it
  // off (embedding-dimensions.spec asserts the toggle starts unchecked), so this
  // flow enables it for itself before driving ingest→done.
  const sql = postgres(DATABASE_URL);
  try {
    await sql`UPDATE user_settings SET embed_request_dimensions = true WHERE id = 1`;
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

async function drainUntilDone(page: Page): Promise<void> {
  // The dev server has no worker; drive the serverless trigger in-process.
  for (let i = 0; i < 12; i++) {
    const res = await page.request.get('/api/cron/work?max=50');
    const body = await res.json();
    if (body.processed === 0) break; // queues drained
    await page.waitForTimeout(500);
  }
}

test('source golden path: add → fetch → done → feed → filter → clear', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);
  await login(page);

  await page.goto('/sources');
  await page.fill('input[name="name"]', 'E2E Source');
  await page.fill('input[name="url"]', RSS_URL);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('E2E Source')).toBeVisible();

  await drainUntilDone(page);

  await page.goto('/admin/jobs');
  await expect(page.getByText(/Done:\s*1/)).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'E2E Pipeline Item' })).toBeVisible();
  await page.getByRole('link', { name: 'E2E Source' }).first().click();
  await expect(page).toHaveURL(/\?source=/);
  await expect(page.getByText(/Source: E2E Source/)).toBeVisible();
  await page.getByText('✕ Clear').click();
  await expect(page).toHaveURL('http://localhost:3000/');
});
