import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://benkyou:benkyou@localhost:5432/benkyou_e2e';

const REPROCESS_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const DELETE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

test.describe('item lifecycle actions', () => {
  test.beforeAll(async () => {
    const sql = postgres(DATABASE_URL);
    try {
      // Two own `done` items so we never mutate the shared seed or depend on order.
      await sql`
        INSERT INTO items (id, url, url_hash, title, summary, raw_content, content_type, state, published_at)
        VALUES
          (${REPROCESS_ID}, 'https://example.com/reprocess-me', 'reprocess-me-hash', 'Reprocess Me',
           's', 'body', 'article', 'done', now()),
          (${DELETE_ID}, 'https://example.com/delete-me', 'delete-me-hash', 'Delete Me',
           's', 'body', 'article', 'done', now())
        ON CONFLICT (id) DO NOTHING`;
    } finally {
      await sql.end();
    }
  });

  test.afterAll(async () => {
    const sql = postgres(DATABASE_URL);
    try {
      await sql`DELETE FROM items WHERE id IN (${REPROCESS_ID}, ${DELETE_ID})`;
    } finally {
      await sql.end();
    }
  });

  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'en', url: 'http://localhost:3000' }]);
    await page.goto('/login');
    await page.fill('input[name="password"]', 'e2e-password');
    await page.click('button[type="submit"]');
    await expect(page.getByPlaceholder(/Paste|粘贴/)).toBeVisible();
  });

  test('reprocess on a done item transitions to the progress view', async ({ page }) => {
    page.on('dialog', (d) => d.accept()); // confirm dialog
    await page.goto(`/items/${REPROCESS_ID}`);
    await expect(page.getByRole('heading', { name: 'Reprocess Me' })).toBeVisible();
    await page.getByRole('button', { name: /^Reprocess$/ }).click();
    // No worker in e2e → item sits at pending → progress view renders.
    await expect(page.getByText(/Processing…|正在处理/)).toBeVisible();
  });

  test('feed-row delete removes the item', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await page.goto('/');
    const row = page.getByRole('article').filter({ hasText: 'Delete Me' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /^Delete$/ }).click();
    await expect(page.getByText('Delete Me')).toHaveCount(0);
  });
});
