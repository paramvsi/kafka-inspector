import { expect, test, type Page } from '@playwright/test';

// Phase 3 gate (prompts/05): poison message → Stalled on Overview, Groups and Topology within 10 s →
// alert fires (bell + toast) → Reset offsets shift +1 on partition 7 → lag drains, Healthy, alert resolves.
// Navigation stays inside the app: a page load would start a fresh simulator.
test.setTimeout(180_000);

// Sidebar links carry a live count ("Consumer groups 6"): match the label with an optional count.
const nav = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: new RegExp(`^${name}( \\d+)?$`) })
    .click();

async function resetPartition7(page: Page) {
  await nav(page, 'Consumer groups');
  await page
    .getByRole('row', { name: /fraud-scorer/ })
    .getByRole('link', { name: 'fraud-scorer', exact: true })
    .click();
  await page.getByRole('button', { name: 'Reset offsets' }).click();
  const dialog = page.getByRole('dialog', { name: /Reset offsets/ });
  await expect(dialog.getByRole('combobox', { name: 'Partitions' })).toHaveValue('7');
  await expect(dialog.getByRole('radio', { name: 'Shift by' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Apply reset to 1 partition' }).click();
}

test('incident end to end: poison → stalled everywhere → alert → reset +1 → recovered', async ({
  page,
}) => {
  await page.goto('/app/');
  await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 });

  // The seeded cluster opens with fraud-scorer already stalled; clear it so the test starts healthy.
  await resetPartition7(page);
  await expect(page.locator('[data-tour="status"]')).toHaveText('Healthy', { timeout: 40_000 });

  // 1. Poison message from the chaos panel
  await nav(page, 'Chaos panel');
  const poison = page.getByRole('article').filter({ hasText: 'Poison message' });
  await poison.getByRole('button', { name: 'Trigger' }).click();
  const t0 = Date.now();

  // 2. Stalled on Overview, Groups and Topology within 10 s
  await nav(page, 'Overview');
  await expect(page.getByRole('link', { name: /fraud-scorer stalled/ })).toBeVisible({
    timeout: 10_000,
  });
  await nav(page, 'Consumer groups');
  await expect(page.getByRole('row', { name: /fraud-scorer/ }).getByText('Stalled')).toBeVisible();
  await nav(page, 'Topology');
  await expect(page.locator('[data-node="fraud-scorer"]')).toContainText('stalled');
  expect(Date.now() - t0).toBeLessThan(10_000 + 5_000); // 10 s budget + navigation time

  // 3. The alert fires: toast and bell
  await expect(
    page.locator('[aria-live=polite] .ki-toast').filter({ hasText: 'Alert: fraud-scorer stalled' }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('link', { name: /Alerts, \d+ firing/ })).toBeVisible();

  // 4. Reset offsets shift +1 on partition 7
  await resetPartition7(page);

  // 5. Lag drains, status Healthy, alert resolves
  await expect(page.locator('[data-tour="status"]')).toHaveText('Healthy', { timeout: 40_000 });
  const lagCell = page
    .getByRole('row', { name: /payments · 7/ })
    .getByRole('cell')
    .nth(4);
  const before = Number((await lagCell.innerText()).replace(/,/g, ''));
  await expect
    .poll(async () => Number((await lagCell.innerText()).replace(/,/g, '')), { timeout: 10_000 })
    .toBeLessThan(before);
  await nav(page, 'Alerts');
  await expect(page.getByRole('article').filter({ hasText: 'fraud-scorer stalled' })).toHaveCount(
    0,
    { timeout: 15_000 },
  );
  await expect(
    page
      .getByRole('row', { name: /fraud-scorer stalled/ })
      .first()
      .getByText('Resolved'),
  ).toBeVisible();
});
