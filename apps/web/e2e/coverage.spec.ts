import { readFileSync } from 'node:fs';
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

test('F-06: "/" focuses the page filter, "g t" and "g o" navigate, "?" opens the sheet', async ({
  page,
}) => {
  await page.goto('/app/topics/');
  await expect(page.getByRole('link', { name: 'orders' })).toBeVisible({ timeout: 15_000 });
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('/');
  await expect(page.locator('main input[type="search"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('g');
  await page.keyboard.press('o');
  await expect(page).toHaveURL(/\/app\/$/);
  await page.keyboard.press('g');
  await page.keyboard.press('t');
  await expect(page).toHaveURL(/\/app\/topics\/$/);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: /Keyboard shortcuts/i })).toBeVisible();
});

test('F-03: arrows move the active option, Esc closes the palette', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('ControlOrMeta+k');
  const pal = page.getByRole('dialog', { name: 'Command palette' });
  const box = pal.getByRole('combobox');
  await box.fill('order');
  const active = pal.locator('[role=option][aria-selected=true]');
  const first = await active.getAttribute('id');
  await box.press('ArrowDown');
  await expect(active).not.toHaveAttribute('id', first!);
  await box.press('ArrowUp');
  await expect(active).toHaveAttribute('id', first!);
  await expect(box).toHaveAttribute('aria-activedescendant', first!);
  await box.press('Escape');
  await expect(pal).toBeHidden();
});

test('F-41: live tail shows new messages, Pause stops them, Resume continues', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  const table = page.getByRole('table', { name: 'Messages in orders' });
  await expect(table.getByRole('row').nth(3)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Live tail').click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  // live rows arrive in batches: wait for the first tail batch, not the browse rows
  await expect(page.getByText('Waiting for messages…')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause' }).click();
  const top = await table.getByRole('row').nth(1).innerText();
  const count = await table.getByRole('row').count();
  await page.waitForTimeout(2500);
  expect(await table.getByRole('row').nth(1).innerText()).toBe(top);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect
    .poll(() => table.getByRole('row').nth(1).innerText(), { timeout: 10_000 })
    .not.toBe(top);
  // Resume continues the list instead of starting over
  expect(await table.getByRole('row').count()).toBeGreaterThanOrEqual(count);
});

test('F-48/F-49: export JSON downloads the shown rows; the column picker adds a value column', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  const table = page.getByRole('table', { name: 'Messages in orders' });
  await expect(table.getByRole('row').nth(5)).toBeVisible({ timeout: 15_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const file = await (await dl).path();
  const rows = JSON.parse(readFileSync(file, 'utf8')) as Array<{ topic: string }>;
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]!.topic).toBe('orders');
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('checkbox', { name: 'total' }).click();
  await expect(page.getByRole('checkbox', { name: 'total' })).toBeChecked();
  await expect(page).toHaveURL(/cols=total/);
  await expect(table.getByRole('columnheader', { name: 'total' })).toBeVisible();
});

test('F-62: earliest and latest dry runs, then apply latest; F-63: delete an empty group', async ({
  page,
}) => {
  await page.goto('/app/groups/view/?id=search-indexer');
  await page.getByRole('button', { name: 'Reset offsets' }).click();
  const dialog = page.getByRole('dialog', { name: /Reset offsets/ });
  await dialog.getByRole('radio', { name: 'Earliest' }).check();
  const dry = dialog.getByRole('table', { name: /Dry run/ });
  await expect(dry.getByRole('row').nth(1)).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('radio', { name: 'Latest' }).check();
  const apply = dialog.getByRole('button', { name: /^Apply reset to \d+ partition/ });
  await expect(apply).toBeEnabled({ timeout: 10_000 });
  await apply.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Lag', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Delete group' }).click();
  await expect(page).toHaveURL(/\/app\/groups\/$/);
  await expect(page.getByRole('link', { name: 'search-indexer', exact: true })).toHaveCount(0);
});

test('F-80: mute 1 h and acknowledge a firing alert', async ({ page }) => {
  await page.goto('/app/alerts/');
  const mute = page.getByRole('button', { name: 'Mute 1 h' }).first();
  await expect(mute).toBeEnabled({ timeout: 40_000 });
  await mute.click();
  await expect(page.getByText('Muted for 1 hour')).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge' }).first().click();
  await expect(page.getByText('Acknowledged').first()).toBeVisible();
});

test('F-32: create topic validates the name and partitions', async ({ page }) => {
  await page.goto('/app/topics/');
  await page.getByRole('button', { name: 'Create topic' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create topic' });
  await dialog.getByLabel('Name').fill('bad name!');
  await expect(
    dialog.getByText('Use letters, numbers, dots, dashes and underscores only.'),
  ).toBeVisible();
  await dialog.getByLabel('Name').fill('ok-name');
  await dialog.getByLabel('Partitions').fill('0');
  await expect(dialog.getByText('Between 1 and 1,000.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create topic' })).toBeDisabled();
});
