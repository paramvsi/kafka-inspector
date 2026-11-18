import { expect, test } from '@playwright/test';

test('alert rule builder previews the last 24 h and saves', async ({ page }) => {
  await page.goto('/app/alerts/');
  await page.getByRole('button', { name: 'New rule' }).click();
  const d = page.getByRole('dialog', { name: 'New alert rule' });
  await expect(d.getByText(/Would have fired \d+ times?/)).toBeVisible({ timeout: 15_000 });
  await d.getByLabel('Name').fill('e2e lag rule');
  await d.getByRole('button', { name: 'Create rule' }).click();
  await expect(page.getByRole('button', { name: /e2e lag rule/ })).toBeVisible();
});

test('topology: stalled node, highlight fades the rest, click opens the group', async ({
  page,
}) => {
  await page.goto('/app/topology/');
  const node = page.locator('[data-node="fraud-scorer"]');
  await expect(node).toContainText('stalled', { timeout: 15_000 });
  await page.getByLabel('Highlight a topic or group').fill('payments');
  await expect(page.locator('[data-node="orders"]')).toHaveCSS('opacity', '0.3');
  await expect(page.locator('[data-node="payments"]')).toHaveCSS('opacity', '1');
  await node.click();
  await expect(page).toHaveURL(/groups\/view\/\?id=fraud-scorer/);
});

test('topology edges flow, and stop under reduced motion', async ({ page }, info) => {
  await page.goto('/app/topology/');
  await expect(page.locator('.ki-flow').first()).toBeAttached({ timeout: 15_000 });
  const anim = await page
    .locator('.ki-flow')
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe(info.project.name === 'reduced-motion' ? 'none' : 'ki-flow');
});

test('chaos: crash a consumer, see Running and the group go Empty, then stop it', async ({
  page,
}) => {
  await page.goto('/app/chaos/');
  const card = page.getByRole('article').filter({ hasText: 'Crash consumer' });
  await card.getByRole('button', { name: 'Trigger' }).click();
  await expect(card.getByText('Running')).toBeVisible();
  await expect(page.getByText(/Running: Crash consumer on order-service/)).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /^Consumer groups( \d+)?$/ })
    .click();
  await expect(
    page
      .getByRole('row', { name: /order-service/ })
      .getByText('Empty')
      .first(),
  ).toBeVisible({ timeout: 10_000 });
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /^Chaos panel$/ })
    .click();
  await page.getByRole('button', { name: 'Stop' }).first().click();
  await expect(card.getByRole('button', { name: 'Trigger' })).toBeVisible();
});

test('guided tour: five steps, keyboard accessible, ends recovered', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/app/chaos/');
  await page.getByRole('button', { name: 'Start guided tour' }).click();
  const tour = page.getByRole('dialog', { name: /of 5/ });
  await expect(tour).toContainText('1 of 5');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('2 of 5');
  await expect(page).toHaveURL(/id=fraud-scorer/);
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('3 of 5');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('4 of 5');
  await tour.getByRole('button', { name: 'Apply for me' }).click();
  await expect(tour).toContainText('5 of 5');
  await expect(tour).toContainText('Now: Healthy', { timeout: 40_000 });
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
});

test('deep links: tab, filter and selected message survive a copy of the URL', async ({ page }) => {
  await page.goto(
    '/app/topics/view/?name=orders&tab=messages&filter=' + encodeURIComponent('value.total > 10'),
  );
  await expect(page.getByText(/scanned match/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'Messages', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('Escape with a dialog open during the tour closes only the dialog, not the tour', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/app/chaos/');
  await page.getByRole('button', { name: 'Start guided tour' }).click();
  const tour = page.getByRole('dialog', { name: /of 5/ });
  for (const n of [2, 3, 4]) {
    await tour.getByRole('button', { name: 'Next' }).click();
    await expect(tour).toContainText(`${n} of 5`);
  }
  const open = page.locator('dialog[open]');
  await expect(open).toHaveCount(1); // step 4 opens Reset offsets
  await open.focus();
  await page.keyboard.press('Escape');
  await expect(open).toHaveCount(0);
  await expect(tour).toContainText('4 of 5');
});

test('deleting an alert rule from its dialog keeps keyboard focus on the page, not <body>', async ({
  page,
}) => {
  await page.goto('/app/alerts/');
  await page.getByRole('button', { name: 'New rule' }).click();
  const d = page.getByRole('dialog', { name: 'New alert rule' });
  await d.getByLabel('Name').fill('e2e focus rule');
  await d.getByRole('button', { name: 'Create rule' }).click();
  await page.getByRole('button', { name: /e2e focus rule/ }).click();
  await page.getByRole('button', { name: 'Delete rule' }).click();
  await expect(page.getByRole('button', { name: /e2e focus rule/ })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});
