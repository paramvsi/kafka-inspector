import { expect, test } from '@playwright/test';

// Functional coverage for acceptance criteria that had no test (docs/FEATURES.md), and audit fixes.

test('F-10: cluster health tiles show brokers, offline partitions, min ISR, controller, alerts', async ({
  page,
}) => {
  await page.goto('/app/');
  const tiles = page.getByRole('group', { name: 'Cluster health' });
  await expect(tiles.getByText('Brokers online')).toBeVisible({ timeout: 15_000 });
  await expect(tiles.getByText('3 of 3')).toBeVisible();
  for (const t of ['Offline partitions', 'Under min ISR', 'Active controller', 'Active alerts'])
    await expect(tiles.getByText(t)).toBeVisible();
  await expect(tiles.getByText(/^broker \d$/)).toBeVisible();
});

test('F-42: key, header and text quick filters narrow the list and live in the URL', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  const table = page.getByRole('table', { name: 'Messages in orders' });
  await expect(table.getByRole('row').nth(5)).toBeVisible({ timeout: 15_000 });
  const firstKey = (
    await table.getByRole('row').nth(1).getByRole('cell').nth(3).innerText()
  ).trim();
  await page.getByLabel('Key contains').fill(firstKey);
  await expect(page).toHaveURL(new RegExp(`fk=${firstKey}`));
  await expect(page.getByText(/^1 of [\d,]+ shown$/)).toBeVisible();
  await page.getByLabel('Text contains').fill('definitely-not-in-any-message');
  await expect(page.getByText('No messages match the filter')).toBeVisible();
  await page.getByRole('button', { name: 'Clear quick filters' }).click();
  await expect(table.getByRole('row').nth(5)).toBeVisible();
  await page.getByLabel('Header', { exact: true }).fill('no-such-header');
  await expect(page.getByText('No messages match the filter')).toBeVisible();
});

test('F-20/22: a broker can be selected from the keyboard', async ({ page }) => {
  await page.goto('/app/brokers/');
  const b2 = page.getByRole('button', { name: /^2 ?, show settings$/ });
  await b2.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/broker=2/);
  await expect(b2).toHaveAttribute('aria-pressed', 'true');
});

test('topic overview shows the real retention, not an assumed 7 days', async ({ page }) => {
  await page.goto('/app/topics/view/?name=clickstream');
  await expect(page.getByText('3-day retention')).toBeVisible({ timeout: 15_000 });
});

test('chaos settings survive a reload and Reset demo returns the controls to the defaults', async ({
  page,
}) => {
  await page.goto('/app/chaos/');
  const slider = page.getByRole('slider', { name: /Base traffic/ });
  await expect(slider).toBeVisible({ timeout: 15_000 });
  await slider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByText('1.5×')).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByText('1.5×')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Reset demo to start' }).click();
  await expect(page.getByText('1.0×')).toBeVisible({ timeout: 15_000 });
});

test('the settings menu reflects a theme change made in the command palette', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('ControlOrMeta+k');
  const pal = page.getByRole('dialog', { name: 'Command palette' });
  await pal.getByRole('combobox').fill('>light');
  await pal.getByRole('combobox').press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(
    page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Light' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('Cancel on a reprocess clears it, so the next Produce is a plain produce', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=orders&produce=1&reprocess=0:0');
  const drawer = page.getByRole('dialog').first();
  await expect(drawer).toBeVisible({ timeout: 15_000 });
  await drawer.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).not.toHaveURL(/reprocess=/);
});
