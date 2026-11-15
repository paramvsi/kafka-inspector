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

test('F-100: created topics and produced messages persist across a reload (IndexedDB)', async ({
  page,
}) => {
  await page.goto('/app/topics/');
  await page.getByRole('button', { name: 'Create topic' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create topic' });
  await dialog.getByLabel('Name').fill('persist-check');
  await dialog.getByLabel('Replication factor').fill('3');
  await dialog.getByRole('button', { name: 'Create topic' }).click();
  await expect(page.getByRole('heading', { name: 'persist-check' })).toBeVisible();
  // F-50: produce 3 at once
  await page.getByRole('button', { name: 'Produce message' }).click();
  const drawer = page.getByRole('dialog', { name: 'Produce message' });
  await drawer.getByLabel('Send').fill('3');
  await drawer.getByRole('button', { name: 'Produce 3 messages' }).click();
  await expect(drawer).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'persist-check' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('link', { name: 'Messages', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Messages in persist-check' }).getByRole('row'),
  ).toHaveCount(4, {
    timeout: 15_000,
  });
});

test('F-51: reprocess a message to the DLQ shortcut', async ({ page }) => {
  await page.goto('/app/topics/view/?name=payments&tab=messages');
  const table = page.getByRole('table', { name: 'Messages in payments' });
  await expect(table.getByRole('row').nth(2)).toBeVisible({ timeout: 15_000 });
  await table.getByRole('row').nth(1).click();
  await page
    .getByRole('dialog', { name: 'Message' })
    .getByRole('button', { name: 'Reprocess to topic' })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Reprocess message' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Send to payments.dlq' }).click();
  await expect(drawer.getByLabel('Target topic')).toHaveValue('payments.dlq');
});

test('F-21/F-22: leader balance note and the all-settings filter', async ({ page }) => {
  await page.goto('/app/brokers/');
  await expect(page.getByText(/leads more than 40% of partitions|Balanced\./)).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: /^All \d+ settings$/ }).click();
  const drawer = page.getByRole('dialog', { name: /all settings/ });
  await drawer.getByLabel('Filter settings').fill('log.retention');
  await expect(drawer.getByText('log.retention.hours')).toBeVisible();
  await expect(drawer.getByText('num.network.threads')).toHaveCount(0);
});

test('F-30: regex filter, starred view and sort by name', async ({ page }) => {
  await page.goto('/app/topics/?q=%5Epay&regex=1');
  const table = page.getByRole('table', { name: 'Topics' });
  await expect(table.getByRole('link', { name: 'payments', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(table.getByRole('link', { name: 'orders', exact: true })).toHaveCount(0);
  await table.getByRole('button', { name: 'Star payments', exact: true }).click();
  await page.goto('/app/topics/?view=starred');
  await expect(
    page
      .getByRole('table', { name: 'Topics' })
      .getByRole('link', { name: 'payments', exact: true }),
  ).toBeVisible();
  await page.goto('/app/topics/?sort=name');
  const first = page.getByRole('table', { name: 'Topics' }).getByRole('row').nth(1);
  await expect(first).toContainText(/audit-log|^a/);
});

test('F-43: multi-topic regex search returns messages from several topics', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages&search=%5E(orders%7Cpayments)%24');
  const table = page.getByRole('table').first();
  await expect(table.getByText('payments', { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(table.getByText('orders', { exact: true }).first()).toBeVisible();
});

test('F-101: slow consumer, traffic spike, broker down, rebalance and hot partition all run', async ({
  page,
}) => {
  await page.goto('/app/chaos/');
  for (const title of [
    'Slow consumer',
    'Traffic spike',
    'Broker down',
    'Rebalance',
    'Hot partition',
  ]) {
    const card = page.getByRole('article').filter({ hasText: title });
    await card.getByRole('button', { name: 'Trigger' }).click();
    await expect(card.getByText('Running').or(card.getByText('Done'))).toBeVisible({
      timeout: 10_000,
    });
  }
  await expect(page.getByRole('listitem').filter({ hasText: 'Broker 2 is down' })).toBeVisible();
});

test('F-110: landing CTAs, comparison and trademark note', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open live demo' }).first()).toHaveAttribute(
    'href',
    /\/app\/?/,
  );
  await expect(
    page.getByText('Kafka Inspector compared with typical free Kafka UIs'),
  ).toBeVisible();
  await expect(page.getByText(/trademarks of the Apache Software Foundation/)).toBeVisible();
});

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });
  test('a value flash or pulse ring leaves no permanent tint when motion is reduced', async ({
    page,
  }) => {
    await page.goto('/app/');
    await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 });
    // the same elements KpiCard / StatusBadge mount after a change (animation is off under reduced motion)
    const opacities = await page.evaluate(() =>
      ['ki-flash', 'ki-pulse-ring'].map((c) => {
        const el = document.createElement('span');
        el.className = c;
        document.querySelector('main')!.appendChild(el);
        const o = getComputedStyle(el).opacity;
        el.remove();
        return o;
      }),
    );
    expect(opacities).toEqual(['0', '0']);
  });
});

test('read-only tooltip: centred on its button, describes it, and Esc hides it (WCAG 1.4.13)', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=orders&preview=readonly');
  const button = page.getByRole('button', { name: 'Produce message' });
  await expect(button).toBeDisabled({ timeout: 15_000 });
  const tipId = await button.getAttribute('aria-describedby');
  expect(tipId).toBeTruthy();
  const tip = page.locator(`[id="${tipId}"]`);
  await expect(tip).toHaveText(/Read-only in this version/);
  await button.hover({ force: true });
  await expect.poll(() => tip.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  const b = (await button.boundingBox())!;
  const t = (await tip.boundingBox())!;
  expect(Math.abs(t.x + t.width / 2 - (b.x + b.width / 2))).toBeLessThan(2);
  await page.keyboard.press('Escape');
  await expect.poll(() => tip.evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
});

test.describe('touch layout', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1180 } });
  test('controls are at least 44 × 44 px on a touch screen (rule 8)', async ({ page }) => {
    await page.goto('/app/topics/');
    await expect(page.getByRole('link', { name: 'orders' })).toBeVisible({ timeout: 15_000 });
    const small = await page
      .locator('main button:visible, header button:visible')
      .evaluateAll((els) =>
        els
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0 && (r.height < 44 || r.width < 44))
          .map((r) => `${Math.round(r.width)}×${Math.round(r.height)}`),
      );
    expect(small).toEqual([]);
  });
});

test('F-47: a masking rule hides a field and the drawer names the rule; F-44 Copy JSON', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/app/topics/view/?name=payments&tab=messages');
  await page.getByRole('button', { name: /^Masking/ }).click();
  const dialog = page.getByRole('dialog', { name: /Masking/ });
  await dialog.getByLabel('Name').fill('hide merchant');
  await dialog.getByLabel('Topics').fill('payments');
  await dialog.getByLabel('JSON path').fill('$.merchantId');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  const table = page.getByRole('table', { name: 'Messages in payments' });
  await expect(table.getByRole('row').nth(2)).toBeVisible({ timeout: 15_000 });
  await table.getByRole('row').nth(1).click();
  const drawer = page.getByRole('dialog', { name: 'Message' });
  await expect(drawer.getByText(/hide merchant/)).toBeVisible();
  await drawer.getByRole('button', { name: 'Copy JSON' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toHaveProperty('paymentId');
  expect(copied).not.toMatch(/merc_\d+/);
});

test('F-46: an undecodable message offers other ways to read it', async ({ page }) => {
  await page.goto('/app/topics/view/?name=payments&tab=messages&p=7&from=group&group=fraud-scorer');
  const table = page.getByRole('table', { name: 'Messages in payments' });
  await expect(table.getByText('Decode failed').first()).toBeVisible({ timeout: 15_000 });
  await table.getByText('Decode failed').first().click();
  const drawer = page.getByRole('dialog', { name: 'Message' });
  await expect(drawer.getByText('Try another way')).toBeVisible();
  await drawer.getByRole('button', { name: 'Show as hex' }).click();
  await expect(page).toHaveURL(/dv=hex/);
});

test('F-60/F-61/F-64: group filter, members tab and share group fields', async ({ page }) => {
  await page.goto('/app/groups/');
  await page.getByLabel('Filter groups').fill('fraud');
  await expect(page.getByRole('row', { name: /fraud-scorer/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('row', { name: /order-service/ })).toHaveCount(0);
  await page.goto('/app/groups/view/?id=order-service');
  await page.getByRole('link', { name: /^Members · \d+/ }).click();
  await expect(
    page
      .getByRole('table')
      .getByText(/order-service-\d/)
      .first(),
  ).toBeVisible();
  await page.goto('/app/groups/view/?id=notify-workers');
  const share = page.getByText('Share group (KIP-932)');
  await expect(share).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Records in flight')).toBeVisible();
  await expect(page.getByText('Acquisition lock')).toBeVisible();
});

test('F-85: topology zoom and fit to screen', async ({ page }) => {
  await page.goto('/app/topology/');
  await expect(page.getByRole('button', { name: 'Fit to screen' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await expect(page.getByText(/fraud-scorer/).first()).toBeVisible();
});

test('F-88/F-89: pick versions to diff; check a candidate schema', async ({ page }) => {
  await page.goto('/app/schemas/?subject=orders-value');
  await page.getByLabel('From version').selectOption('3');
  await page.getByLabel('To version').selectOption('4');
  await expect(page).toHaveURL(/from=3/);
  await page.getByRole('button', { name: 'Check a new version' }).click();
  const dialog = page.getByRole('dialog', { name: /Check a new version/ });
  await dialog.getByRole('button', { name: 'Start from the latest version' }).click();
  await dialog.getByRole('button', { name: 'Check compatibility' }).click();
  await expect(dialog.getByText(/compatible/i).first()).toBeVisible();
});

test('F-95: add a local agent cluster that does not answer, then save without connecting', async ({
  page,
}) => {
  await page.goto('/app/clusters/');
  await page.getByRole('button', { name: 'Add cluster' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add cluster' });
  await dialog.getByLabel('Name').fill('staging');
  await dialog.getByLabel('Agent URL').fill('http://127.0.0.1:9');
  await dialog.getByRole('button', { name: 'Save without connecting' }).click();
  await expect(page.getByRole('row', { name: /staging/ })).toBeVisible();
});

test('F-72: 1h, 24h and 7d ranges load history', async ({ page }) => {
  for (const r of ['1h', '24h', '7d']) {
    await page.goto(`/app/?range=${r}`);
    await expect(page.getByRole('button', { name: r, pressed: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 15_000 });
  }
});

test('F-01/F-14: sidebar sections, firing-alert chip and the recent events feed', async ({
  page,
}) => {
  await page.goto('/app/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const s of ['Monitor', 'Data', 'Operate'])
    await expect(nav.getByText(s, { exact: true })).toBeVisible();
  await expect(page.getByText('Recent events')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Poison message on payments-7/).first()).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Alerts [1-9]\d*$/ })).toBeVisible({
    timeout: 45_000,
  });
});
