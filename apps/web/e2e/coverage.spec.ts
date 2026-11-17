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

test('Reset demo returns the controls to the defaults without a reload in between', async ({
  page,
}) => {
  await page.goto('/app/chaos/');
  const slider = page.getByRole('slider', { name: /Base traffic/ });
  await expect(slider).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('1.0×')).toBeVisible();
  await slider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByText('1.5×')).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Reset demo to start' }).click();
  await expect(page.getByText('Demo reset')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('1.0×')).toBeVisible();
});

test('Show in messages after reprocessing to another topic opens that topic', async ({ page }) => {
  await page.goto('/app/topics/view/?name=payments&produce=1&reprocess=0:0');
  const drawer = page.getByRole('dialog', { name: 'Reprocess message' });
  await drawer.getByRole('button', { name: 'Send to payments.dlq' }).click({ timeout: 15_000 });
  await drawer.getByRole('button', { name: /^Produce 1 message/ }).click();
  await page.getByRole('button', { name: 'Show in messages' }).click();
  await expect(page).toHaveURL(/[?&]name=payments\.dlq(&|$)/);
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
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  // live rows arrive in batches: wait for the first tail batch, not the browse rows
  await expect(page.getByText('Waiting for messages…')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const top = await table.getByRole('row').nth(1).innerText();
  const count = await table.getByRole('row').count();
  await page.waitForTimeout(2500);
  expect(await table.getByRole('row').nth(1).innerText()).toBe(top);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
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

test('a group deleted while its page is cached says it no longer exists, not its old numbers', async ({
  page,
}) => {
  await page.goto('/app/groups/view/?id=search-indexer');
  await page.getByRole('button', { name: 'Delete group' }).click();
  await expect(page).toHaveURL(/\/app\/groups\/$/);
  await page.goBack(); // the cached detail is still there; the next poll says not found
  await expect(
    page.getByText('Consumer group search-indexer not found', { exact: true }),
  ).toBeVisible({
    timeout: 10_000,
  });
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
    .getByRole('dialog', { name: 'Message', exact: true })
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
  browserName,
}) => {
  // clipboard permissions exist only in Chromium; Firefox and WebKit check masking, not the copy
  if (browserName === 'chromium')
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/app/topics/view/?name=payments&tab=messages');
  await page.getByRole('button', { name: /^Masking/ }).click();
  const dialog = page.getByRole('dialog', { name: /Masking/ });
  await dialog.getByLabel('Name').fill('hide merchant');
  await dialog.getByLabel('Topics').fill('payments');
  await dialog.getByLabel('JSON path').fill('$.merchantId');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const table = page.getByRole('table', { name: 'Messages in payments' });
  await expect(table.getByRole('row').nth(2)).toBeVisible({ timeout: 15_000 });
  await table.getByRole('row').nth(1).click();
  const drawer = page.getByRole('dialog', { name: 'Message', exact: true });
  await expect(drawer.getByText(/hide merchant/)).toBeVisible();
  if (browserName !== 'chromium') return;
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
  const drawer = page.getByRole('dialog', { name: 'Message', exact: true });
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
  // nothing invented (rule 7): like the agent, the demo doesn't make up delivery counts or lock times
  await expect(page.getByText(/aren.t reported by Kafka.s Admin API/)).toBeVisible();
  await expect(page.getByText('Acquisition lock')).toHaveCount(0);
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

test('F-11/F-12/F-13: peak annotation, attention items link to the fix screen, group sparklines', async ({
  page,
}) => {
  await page.goto('/app/');
  await expect(page.getByText(/^peak [\d,]+\/s at \d\d:\d\d$/)).toBeVisible({ timeout: 15_000 });
  const item = page.getByRole('link', { name: /fraud-scorer/ }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(/groups\/view\/\?id=fraud-scorer|tab=messages/);
  await page.goto('/app/');
  await expect(page.locator('svg[aria-hidden="true"] polyline, svg polyline').first()).toBeAttached(
    {
      timeout: 15_000,
    },
  );
});

test('F-02: the cluster switcher lists clusters with status and links to Manage clusters', async ({
  page,
}) => {
  await page.goto('/app/topics/');
  await expect(page.getByRole('link', { name: 'orders' })).toBeVisible({ timeout: 15_000 }); // booted
  await page.getByRole('button', { name: /^Cluster .*Switch cluster$/ }).click();
  const menu = page.locator('#ki-cluster-menu');
  await expect(menu.getByText('prod-eu-1')).toBeVisible();
  await expect(menu.getByText(/Connected|Degraded|Disconnected/).first()).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Manage clusters' })).toHaveAttribute(
    'href',
    '/app/clusters/',
  );
});

test('F-15: the disconnected banner offers Retry now and Edit connection', async ({ page }) => {
  await page.goto('/app/?preview=disconnected');
  await expect(page.getByRole('button', { name: 'Retry now' }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('link', { name: 'Edit connection' })).toHaveAttribute(
    'href',
    '/app/clusters/',
  );
  await expect(page.getByText(/attempt \d+ of \d+/)).toBeVisible();
});

test('F-31: the no-results state offers to create the searched topic', async ({ page }) => {
  await page.goto('/app/topics/?q=shipments-eu');
  await page.getByRole('button', { name: 'Create “shipments-eu”' }).click();
  await expect(page.getByRole('dialog', { name: 'Create topic' }).getByLabel('Name')).toHaveValue(
    'shipments-eu',
  );
});

test('F-33/34/35/37/39: topic tabs show partitions with skew, consumers with status, the schema link, freshness', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=clickstream&tab=partitions');
  await expect(page.getByRole('columnheader', { name: /Share|Skew/ }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.goto('/app/topics/view/?name=payments&tab=consumers');
  await expect(page.getByRole('row', { name: /fraud-scorer.*Stalled/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.goto('/app/topics/view/?name=orders&tab=schema');
  await expect(page.getByRole('link', { name: 'Compare versions' })).toHaveAttribute(
    'href',
    /subject=orders-value/,
  );
  await page.goto('/app/topics/');
  await expect(page.getByRole('row', { name: /orders/ }).first()).toContainText(/now|\ds ago/);
});

test('F-40: start from a time positions the browse at that time', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  await page.getByLabel('Start from').selectOption('timestamp');
  await page.getByLabel('From time').fill('2026-11-15T10:00');
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page).toHaveURL(/ts=2026-11-15T/);
});

test('F-81/F-83: seeded rules are listed; a topic-silent rule can be created', async ({ page }) => {
  await page.goto('/app/alerts/?tab=rules');
  for (const r of [
    'Consumer group stalled or stopped',
    'Lag above 5,000 for 5 min',
    'Under-replicated partitions',
    'Broker offline',
    'Topic silent for 10 min',
    'DLQ receiving messages',
  ])
    await expect(page.getByText(r).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'New rule' }).click();
  const d = page.getByRole('dialog', { name: 'New alert rule' });
  await d.getByLabel('Name').fill('inventory silent');
  await d.getByLabel('Metric').selectOption('topic-silent');
  await d.getByRole('button', { name: 'Create rule' }).click();
  await expect(page.getByText('inventory silent').first()).toBeVisible();
});

test('F-87: the subject list shows version, type and compatibility', async ({ page }) => {
  await page.goto('/app/schemas/');
  const item = page.getByRole('link', { name: /orders-value/ });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click();
  await expect(page.getByText(/Avro\s*BACKWARD/).first()).toBeVisible();
  await expect(page.getByText(/BACKWARD|FULL|NONE|FORWARD/).first()).toBeVisible();
});

test('after Reset demo, live data keeps flowing (no reload needed)', async ({ page }) => {
  await page.goto('/app/chaos/');
  await page.getByRole('button', { name: 'Reset demo to start' }).click();
  await expect(page.getByText('Demo reset')).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /^Consumer groups/ })
    .click();
  const lag = page
    .getByRole('row', { name: /fraud-scorer/ })
    .getByRole('cell')
    .nth(5);
  await expect(lag).toBeVisible({ timeout: 15_000 });
  const first = await lag.innerText();
  await expect.poll(() => lag.innerText(), { timeout: 8000 }).not.toBe(first);
});

test('F-07: keyboard focus shows the focus ring', async ({ page }) => {
  await page.goto('/app/topics/');
  await expect(page.getByRole('link', { name: 'orders' })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Tab'); // skip link
  await page.keyboard.press('Tab');
  const style = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { tag: el.tagName, outline: s.outlineStyle, width: s.outlineWidth };
  });
  expect(style.outline).toBe('solid');
  expect(style.width).toBe('2px');
});

test('F-08: dialogs transition in, the tour spotlight tracks its target, landing sections reveal', async ({
  page,
}) => {
  await page.goto('/app/topics/');
  await page.getByRole('button', { name: 'Create topic' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create topic' });
  const d = await dialog.evaluate((e) => getComputedStyle(e).transitionDuration);
  expect(d.split(',').some((x) => parseFloat(x) > 0)).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/');
  const reveal = page.locator('.ki-reveal-once').last();
  await reveal.scrollIntoViewIfNeeded();
  await expect(reveal).toHaveAttribute('data-reveal', 'shown');
  await expect.poll(() => reveal.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
});

test.describe('reduced motion, overlays', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });
  test('dialogs and landing reveals appear without animation', async ({ page }) => {
    await page.goto('/');
    const reveal = page.locator('.ki-reveal-once').last();
    expect(await reveal.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    await page.goto('/app/topics/');
    await page.getByRole('button', { name: 'Create topic' }).click();
    const d = await page
      .getByRole('dialog', { name: 'Create topic' })
      .evaluate((e) => getComputedStyle(e).transitionDuration);
    // MOTION.md: no movement under reduced motion — fades of at most 120 ms, everything else ~instant
    expect(d.split(',').every((x) => parseFloat(x) <= 0.12)).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    const pop = await page
      .locator('#ki-settings')
      .evaluate((e) => getComputedStyle(e).transitionDuration);
    expect(pop.split(',').every((x) => parseFloat(x) <= 0.12)).toBe(true);
  });
});

test('F-08: the tour spotlight frames its target', async ({ page }) => {
  await page.goto('/app/chaos/');
  await page.getByRole('button', { name: 'Start guided tour' }).click();
  await expect(page.getByRole('dialog', { name: /of 5/ })).toBeVisible({ timeout: 15_000 });
  const spot = page.locator('.ki-spotlight');
  await expect(spot).toBeVisible({ timeout: 15_000 });
  expect((await spot.boundingBox())!.width).toBeGreaterThan(20);
});

test('Produce after a reprocess has no leftover key or reprocessed-from header', async ({
  page,
}) => {
  // Produce after a reprocess: no leftover key or reprocessed-from header
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  const table = page.getByRole('table', { name: 'Messages in orders' });
  await expect(table.getByRole('row').nth(2)).toBeVisible({ timeout: 15_000 });
  await table.getByRole('row').nth(1).click();
  await page
    .getByRole('dialog', { name: 'Message', exact: true })
    .getByRole('button', { name: 'Reprocess to topic' })
    .click();
  const re = page.getByRole('dialog', { name: 'Reprocess message' });
  await expect(re.getByLabel('Key')).not.toHaveValue('', { timeout: 10_000 });
  await re.getByRole('button', { name: 'Cancel' }).click();
  // the message drawer is still open underneath: close it too
  await page
    .getByRole('dialog', { name: 'Message', exact: true })
    .getByRole('button', { name: 'Close' })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Message', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Produce message' }).click();
  const pr = page.getByRole('dialog', { name: 'Produce message' });
  await expect(pr.getByLabel('Key')).toHaveValue('');
  // inputValue per field: evaluateAll crashes Firefox's Playwright driver on this dialog (the app is fine)
  const fields = await pr.locator('input[aria-label="Header value"]').all();
  const headerValues = await Promise.all(fields.map((f) => f.inputValue()));
  expect(headerValues.some((v) => v.includes('@'))).toBe(false); // no reprocessed-from header
  await pr.getByRole('button', { name: 'Cancel' }).click();
});

test('Create topic starts from the defaults each time', async ({ page }) => {
  await page.goto('/app/topics/');
  await page.getByRole('button', { name: 'Create topic' }).click();
  const ct = page.getByRole('dialog', { name: 'Create topic' });
  await ct.getByLabel('Replication factor').fill('1');
  await ct.getByRole('button', { name: 'Cancel' }).click();
  await expect(ct).toBeHidden();
  await page.getByRole('button', { name: 'Create topic' }).click();
  await expect(ct.getByLabel('Replication factor')).toHaveValue('3');
});

test("topic A's filter draft is not shown on topic B", async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  await page.getByLabel(/^JavaScript filter/).fill('value.total > 1');
  await page.getByRole('link', { name: 'Topics', exact: true }).first().click();
  await page.getByRole('link', { name: 'payments', exact: true }).click();
  await page.getByRole('link', { name: 'Messages', exact: true }).click();
  await expect(page.getByLabel(/^JavaScript filter/)).toHaveValue('');
});

test('a ?produce=1 deep link does not open Produce on a read-only cluster', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&produce=1&preview=readonly');
  await expect(page.getByRole('heading', { name: 'orders' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog', { name: 'Produce message' })).toHaveCount(0);
});

test('F-43: ticking Sample refetches the search across partitions', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages&search=%5Eorders%24');
  const table = page.getByRole('table').first();
  await expect(table.getByRole('row').nth(5)).toBeVisible({ timeout: 15_000 });
  const partitions = () =>
    table
      .getByRole('row')
      .evaluateAll(
        (rows) => new Set(rows.slice(1, 40).map((r) => r.children[2]?.textContent)).size,
      );
  expect(await partitions()).toBe(1); // without sampling: the busiest partition only
  await page.getByLabel('Sample across partitions').click();
  await expect.poll(partitions, { timeout: 10_000 }).toBeGreaterThan(1);
});

test('a missing topic or group stays "not found" (no flicker)', async ({ page }) => {
  for (const [path, title] of <Array<[string, string]>>[
    ['/app/groups/view/?id=nope', 'Consumer group nope not found'],
    ['/app/topics/view/?name=nonexistent', 'Topic nonexistent not found'],
  ]) {
    await page.goto(path);
    await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 15_000 });
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(250);
      await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 100 });
    }
  }
});

test('an alert threshold that is not a number of 0 or more is refused, not saved as 0', async ({
  page,
}) => {
  await page.goto('/app/alerts/?tab=rules');
  await page.getByRole('button', { name: 'New rule' }).click();
  const d = page.getByRole('dialog', { name: 'New alert rule' });
  for (const v of ['abc', '', '-1']) {
    await d.getByLabel('Threshold', { exact: true }).fill(v);
    await expect(d.getByText('Enter a number of 0 or more.')).toBeVisible();
    await expect(d.getByRole('button', { name: 'Create rule' })).toBeDisabled();
  }
  await d.getByLabel('Threshold', { exact: true }).fill('250');
  await expect(d.getByRole('button', { name: 'Create rule' })).toBeEnabled();
});

test('pausing Live stays paused across pages and tabs', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Live' }).click();
  await expect(page.getByRole('button', { name: 'Paused. Resume live updates' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: /^Topics/ }).click();
  await page.getByRole('link', { name: 'orders', exact: true }).click();
  await page.getByRole('link', { name: 'Messages', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Messages in orders' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Paused' })).toBeVisible();
});

test('Add cluster refuses credentials in the URL, bad URLs, blank seeds and duplicate names; old stored passwords are dropped', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'ki-saved-clusters',
      JSON.stringify([
        {
          id: 'c_1',
          name: 'old',
          color: 'chart-2',
          mode: 'local-agent',
          url: 'http://admin:hunter2@localhost:9999',
          readOnly: true,
        },
      ]),
    ),
  );
  await page.goto('/app/clusters/?add=1');
  const d = page.getByRole('dialog', { name: 'Add cluster' });
  const save = d.getByRole('button', { name: 'Save without connecting' });
  await d.getByLabel('Agent URL').fill('http://admin:hunter2@localhost:9999');
  await expect(d.getByText('Leave the user name and password out of the URL')).toBeVisible();
  await expect(save).toBeDisabled();
  await d.getByLabel('Agent URL').fill('http://localhost:9999/?token=abc');
  await expect(d.getByText('Leave the query and # part out of the URL')).toBeVisible();
  await expect(save).toBeDisabled();
  await d.getByLabel('Agent URL').fill('not a url');
  await expect(save).toBeDisabled();
  await d.getByLabel('Agent URL').fill('http://localhost:9999');
  await d.getByLabel('Name').fill('old');
  await expect(d.getByText('A cluster named old already exists')).toBeVisible();
  await expect(save).toBeDisabled();
  await d.getByLabel('Name').fill('new-one');
  await expect(save).toBeEnabled();
  await expect(page.getByText('hunter2')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('ki-saved-clusters')))
    .not.toContain('hunter2');
});

test('hand-edited links fall back instead of crashing or showing NaN', async ({ page }) => {
  const errors: string[] = [];
  // WebKit on Linux reports a fetch cancelled by the next page.goto as "… due to access control checks":
  // that's the test navigating away mid-request, not an app error
  page.on('pageerror', (e) => {
    if (!/due to access control checks/.test(e.message)) errors.push(e.message);
  });
  for (const q of ['dk=bogus', 'dv=bogus', 'from=bogus&p=abc', 'msg=abc']) {
    await page.goto(`/app/topics/view/?name=orders&tab=messages&${q}`);
    await expect(page.getByRole('table', { name: 'Messages in orders' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/NaN|undefined/)).toHaveCount(0);
  }
  for (const q of ['from=abc', 'to=abc', 'from=99&to=-1']) {
    await page.goto(`/app/schemas/?subject=orders-value&${q}`);
    await expect(page.getByRole('heading', { name: 'orders-value' }).first()).toBeVisible({
      timeout: 15_000,
    });
  }
  await page.goto('/app/schemas/?subject=nope');
  await expect(page.getByText('Subject nope not found')).toBeVisible({ timeout: 15_000 });
  await page.goto('/app/brokers/?broker=abc');
  await expect(page.getByText(/Broker \d+/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/NaN/)).toHaveCount(0);
  await page.goto('/app/self-host/');
  const port = page.getByLabel('Port');
  await port.fill('');
  await expect(page.getByText('Enter a port from 1 to 65535.')).toBeVisible();
  await port.fill('9000');
  await expect(port).toHaveValue('9000');
  await port.fill('99999');
  await expect(page.getByText('Enter a port from 1 to 65535.')).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('touch layout', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 768, height: 1024 } });
  test('nav links and the search box are at least 44px tall on a coarse pointer', async ({
    page,
  }) => {
    await page.goto('/app/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link').first()).toBeVisible({ timeout: 15_000 });
    const heights = await nav
      .getByRole('link')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    const search = page.locator('header input').first();
    expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test('a ?reset=1 deep link does not open Reset offsets on a read-only cluster (rule 5)', async ({
  page,
}) => {
  await page.goto('/app/groups/view/?id=fraud-scorer&reset=1&preview=readonly');
  await expect(page.locator('h1', { hasText: 'fraud-scorer' })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the scanned count adds up across Load more pages', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  const footer = page.getByText(/[\d,]+ messages · [\d,]+ scanned/);
  await expect(footer).toBeVisible({ timeout: 15_000 });
  const scanned = async () =>
    Number((await footer.innerText()).match(/· ([\d,]+) scanned/)![1]!.replace(/,/g, ''));
  const before = await scanned();
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByText(/^200 messages/)).toBeVisible({ timeout: 15_000 });
  expect(await scanned()).toBeGreaterThan(before);
});

test('a DLQ rule carries no hidden threshold from the lag default', async ({ page }) => {
  await page.goto('/app/alerts/?tab=rules');
  await page.getByRole('button', { name: 'New rule' }).click();
  const d = page.getByRole('dialog', { name: 'New alert rule' });
  await d.getByLabel('Metric').selectOption('dlq-receiving');
  await d.getByLabel('Name').fill('dlq-check');
  await d.getByRole('button', { name: 'Create rule' }).click();
  await expect(d).toHaveCount(0);
  // read the saved rule from the simulator's IndexedDB
  const threshold = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('kafka-inspector-demo');
        open.onsuccess = () => {
          const get = open.result.transaction('kv').objectStore('kv').get('rules');
          get.onsuccess = () =>
            resolve(
              (get.result.v as Array<{ name: string; threshold?: number }>).find(
                (r) => r.name === 'dlq-check',
              )?.threshold ?? null,
            );
        };
      }),
  );
  expect(threshold).toBeNull();
});

test('turning Live tail off and on again starts a running tail, not a paused one', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  await page.getByLabel('Live tail').click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByLabel('Live tail').click();
  await page.getByLabel('Live tail').click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('fast typing into a URL-bound filter keeps every character', async ({ page }) => {
  await page.goto('/app/topics/');
  const box = page.getByLabel('Filter topics');
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.pressSequentially('order events', { delay: 0 });
  await expect(box).toHaveValue('order events');
  await expect(page).toHaveURL(/[?&]q=order(\+|%20)events/);
});

test('a simulator worker that fails to load shows an error, not an endless spinner', async ({
  page,
}) => {
  await page.route('**/_next/static/chunks/turbopack-worker-*', (r) => r.abort());
  await page.goto('/app/');
  await expect(page.getByText(/Couldn't start: The simulated cluster stopped/)).toBeVisible({
    timeout: 10_000,
  });
});

test('a stored preference of the wrong shape is ignored, not a crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('ki-starred-topics', '5'));
  await page.goto('/app/topics/');
  await expect(page.getByRole('link', { name: 'orders', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect(errors).toEqual([]);
});

test('a saved tour step past the end (an older, longer tour) is dropped, not a crash', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('ki-tour-step', '99'));
  await page.goto('/app/topics/');
  await expect(page.getByRole('link', { name: 'orders', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('ki-tour-step'))).toBeNull();
});

test('the virtualised messages table numbers its rows for screen readers', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  const table = page.getByRole('table', { name: 'Messages in orders' });
  await expect(table.getByRole('row').nth(5)).toBeVisible({ timeout: 15_000 });
  await expect(table).toHaveAttribute('aria-rowcount', '101'); // 100 messages + header
  await table.evaluate((t) => {
    const s = t.closest('[class*="overflow"]') ?? t.parentElement!;
    s.scrollTop = s.scrollHeight;
  });
  await expect(table.locator('tbody tr[aria-rowindex]').last()).toHaveAttribute(
    'aria-rowindex',
    '101',
  );
});

test('a disabled checkbox looks disabled; a form error is announced', async ({ page }) => {
  await page.goto('/app/clusters/?add=1');
  const d = page.getByRole('dialog', { name: 'Add cluster' });
  const label = d.locator('label', { hasText: 'Read-only (always, in this version)' });
  expect(Number(await label.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);
  await d.getByLabel('Agent URL').fill('not a url');
  await expect(d.getByRole('alert')).toContainText('Enter a full URL');
});

test('junk list params fall back to the defaults (no NaN, no empty list)', async ({ page }) => {
  await page.goto('/app/topics/?view=bogus&sort=bogus&page=abc');
  await expect(page.getByRole('link', { name: 'orders', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('main').getByText(/NaN|undefined/)).toHaveCount(0);
  await page.goto('/app/groups/?type=bogus');
  await expect(page.getByRole('link', { name: 'fraud-scorer', exact: true })).toBeVisible({
    timeout: 15_000,
  });
});

test('a rule switched to lag saves the threshold it shows; empty topics and bad partitions read right', async ({
  page,
}) => {
  await page.goto('/app/alerts/?tab=rules&rule=r-group-stalled');
  const d = page.getByRole('dialog', { name: 'Edit alert rule' });
  await d.getByLabel('Metric').selectOption('lag');
  await expect(d.getByLabel('Threshold', { exact: true })).toHaveValue('5000'); // lag's default
  await d.getByRole('button', { name: 'Save rule' }).click();
  await expect(d).toHaveCount(0);
  const threshold = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('kafka-inspector-demo');
        open.onsuccess = () => {
          const get = open.result.transaction('kv').objectStore('kv').get('rules');
          get.onsuccess = () =>
            resolve(
              (get.result.v as Array<{ id: string; threshold?: number }>).find(
                (r) => r.id === 'r-group-stalled',
              )?.threshold ?? null,
            );
        };
      }),
  );
  expect(threshold).toBe(5000);

  await page.goto('/app/topics/?create=1');
  const c = page.getByRole('dialog', { name: 'Create topic' });
  await c.getByLabel('Name').fill('empty-for-e2e');
  await c.getByRole('button', { name: 'Create topic' }).click();
  await page.goto('/app/topics/view/?name=empty-for-e2e');
  await expect(page.getByText('nothing produced yet')).toBeVisible({ timeout: 15_000 });

  await page.goto('/app/topics/view/?name=orders&tab=messages&p=99');
  const table = page.getByRole('table', { name: 'Messages in orders' });
  await expect(table.getByRole('row').nth(5)).toBeVisible({ timeout: 15_000 });
});

test('"From time" without a time asks for one instead of claiming the topic is empty', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages&from=timestamp');
  await expect(page.getByText('Choose where to start')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Pick a date and time to read from.')).toBeVisible();
  await expect(page.getByText('no messages in its retention window')).toHaveCount(0);
});

test('a CSV export starts with a UTF-8 BOM so Excel reads non-ASCII text', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  await expect(
    page.getByRole('table', { name: 'Messages in orders' }).getByRole('row').nth(5),
  ).toBeVisible({
    timeout: 15_000,
  });
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const bytes = (await import('node:fs')).readFileSync(await dl.path());
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
});

test('"Watch on Overview" in the chaos toast keeps the incident running', async ({ page }) => {
  await page.goto('/app/chaos/');
  const card = page.getByRole('article').filter({ hasText: 'Slow consumer' });
  await card.getByRole('button', { name: 'Trigger' }).click();
  await page.getByRole('button', { name: 'Watch on Overview' }).first().click();
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 });
  await page.goBack();
  await expect(
    page.getByRole('article').filter({ hasText: 'Slow consumer' }).getByText('Running'),
  ).toBeVisible({
    timeout: 10_000,
  });
});

test('pausing Live freezes polled data too (group detail lag stops moving)', async ({ page }) => {
  await page.goto('/app/groups/view/?id=fraud-scorer');
  const lag = page
    .locator('div', { hasText: /^Total lag/ })
    .locator('.font-mono')
    .first();
  await expect(lag).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Live' }).click();
  await expect(page.getByRole('button', { name: 'Paused' })).toBeVisible();
  const before = await lag.innerText();
  await page.waitForTimeout(3000);
  expect(await lag.innerText()).toBe(before);
});

test('a hex view on a masked topic never shows the masked field as bytes', async ({ page }) => {
  // orders is Avro: its raw bytes can't be masked field by field, so they are hidden
  await page.goto('/app/topics/view/?name=orders&tab=messages&dv=hex');
  const table = page.getByRole('table', { name: 'Messages in orders' });
  await expect(table.getByRole('row').nth(2)).toBeVisible({ timeout: 15_000 });
  await table.getByRole('row').nth(1).click();
  const drawer = page.getByRole('dialog', { name: 'Message', exact: true });
  await expect(drawer.getByText(/Raw bytes hidden: masking rule/)).toBeVisible();
  await expect(drawer.getByText(/\b40 [0-9a-f]{2} [0-9a-f]{2}/)).toHaveCount(0); // no "@" byte run
});

test('a stale page number lands on the last real page; the groups filter ignores case', async ({
  page,
}) => {
  await page.goto('/app/topics/?page=9');
  await expect(page.getByRole('link', { name: /^[a-z]/ }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Page (\d+) of \1$/)).toBeVisible();
  await page.goto('/app/groups/?q=ORDER');
  await expect(page.getByRole('link', { name: 'order-service', exact: true })).toBeVisible({
    timeout: 15_000,
  });
});

test('Enter creates a topic; a bad regex says so; a paused Live freezes the tail', async ({
  page,
}) => {
  await page.goto('/app/topics/?create=1');
  const d = page.getByRole('dialog', { name: 'Create topic' });
  await d.getByLabel('Name').fill('enter-created');
  await d.getByLabel('Name').press('Enter');
  await expect(d).toHaveCount(0, { timeout: 10_000 });

  await page.goto('/app/topics/?q=%5B');
  await expect(page.getByText("Couldn't list topics")).toBeVisible({ timeout: 15_000 });

  await page.goto('/app/topics/view/?name=orders&tab=messages');
  await expect(
    page.getByText('Needs attention').or(page.getByRole('table', { name: 'Messages in orders' })),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Live. Pause live updates' }).click();
  await page.getByLabel('Live tail').click();
  const rows = page.getByRole('table', { name: 'Messages in orders' }).getByRole('row');
  await page.waitForTimeout(1500);
  const before = await rows.count();
  await page.waitForTimeout(3000);
  expect(await rows.count()).toBe(before); // paused: no new tail rows arrive
});

test('muting an alert takes it out of the "N firing" count, as in the bell', async ({ page }) => {
  await page.goto('/app/alerts/');
  const sub = page.getByText(/^(\d+) firing · /);
  await expect(page.getByRole('button', { name: 'Mute 1 h' }).first()).toBeVisible({
    timeout: 20_000,
  });
  const n = Number((await sub.innerText()).match(/^(\d+)/)![1]);
  await page.getByRole('button', { name: 'Mute 1 h' }).first().click();
  await expect(sub).toHaveText(new RegExp(`^${n - 1} firing · `), { timeout: 10_000 });
});

test('a dialog with its own width gets it (the shortcuts dialog is 440 px, not the 560 px default)', async ({
  page,
}) => {
  await page.goto('/app/');
  await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('?');
  const d = page.getByRole('dialog').first();
  await expect(d).toBeVisible();
  expect(Math.round((await d.boundingBox())!.width)).toBeLessThanOrEqual(445);
});

test('an offline partition is labelled offline on the topic list, not only under-replicated', async ({
  page,
}) => {
  await page.goto('/app/chaos/');
  const card = page.getByRole('article').filter({ hasText: 'Broker down' });
  await card.getByRole('button', { name: 'Trigger' }).click();
  await page.getByRole('link', { name: 'Topics', exact: true }).first().click(); // in-app: keeps the worker
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: 'audit-log' })
      .getByText(/partitions? offline/),
  ).toBeVisible({ timeout: 20_000 });
});

test('the messages footer counts the rows the key filter keeps', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  const footer = page.getByText(/messages · .* scanned/);
  await expect(footer).toBeVisible({ timeout: 15_000 });
  const firstKey = (await page.getByRole('row').nth(1).getByRole('cell').nth(2).innerText()).trim();
  await page.getByLabel('Key contains').fill(firstKey);
  await expect(async () => {
    const rows = (await page.getByRole('row').count()) - 1;
    expect(await footer.innerText()).toMatch(new RegExp(`^${rows} messages`));
  }).toPass({ timeout: 10_000 });
});

test('a message link to an offset that does not exist says so instead of loading forever', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=payments&tab=messages&p=7&msg=7%3A99999999999');
  const drawer = page.getByRole('dialog', { name: 'Message' });
  await expect(drawer.getByText('payments · partition 7 · offset 99,999,999,999')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    drawer.getByText(/past the end of the partition or no longer retained/),
  ).toBeVisible();
});

test('a link to a deleted alert rule says so instead of opening a blank new-rule form', async ({
  page,
}) => {
  await page.goto('/app/alerts/?rule=no-such-rule');
  await expect(page.getByText('Rule not found')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('dialog', { name: /alert rule/i })).toHaveCount(0);
});

test('the page behind an open dialog does not scroll', async ({ page }) => {
  await page.goto('/app/topics/');
  await expect(page.getByRole('row').nth(1)).toBeVisible({ timeout: 15_000 }); // app booted
  await expect(async () => {
    await page.keyboard.press('?'); // the shortcut handler attaches after hydration
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe(
    'hidden',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe(
    'hidden',
  );
});

test('on a read-only cluster "Edit config" is disabled with the read-only hint, like the other writes', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=orders&preview=readonly');
  await expect(page.getByRole('button', { name: 'Produce message' })).toBeDisabled({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Edit config' })).toBeDisabled();
});

test('a start offset past the end says so, not "no messages in its retention window"', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=audit-log&tab=messages&from=offset&offset=999999999999');
  await expect(
    page.getByText(/No messages at or after offset 999,999,999,999 in any partition/),
  ).toBeVisible({
    timeout: 15_000,
  });
});

test('a mistyped address gets a branded page with a way back, not a bare 404', async ({ page }) => {
  // Netlify serves out/404.html for unknown paths; the local static server doesn't, so open it directly
  await page.goto('/404.html');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('link', { name: 'Open the overview' })).toHaveAttribute(
    'href',
    /\/app\/?$/,
  );
});

test('duration utilities come from the motion tokens (rule 11), including under reduced motion', async ({
  page,
}) => {
  await page.goto('/app/topics/');
  const row = page.getByRole('row').nth(1);
  await expect(row).toBeVisible({ timeout: 15_000 });
  const [got, token] = await row.evaluate((el) => [
    getComputedStyle(el).transitionDuration,
    getComputedStyle(document.documentElement).getPropertyValue('--dur-instant').trim(),
  ]);
  // the row uses duration-instant: its duration is the token, not Tailwind's 150 ms default
  expect(got).not.toBe('0.15s');
  const ms = (v: string) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
  expect(ms(got)).toBeCloseTo(ms(token), 3);
});

test.describe('touch layout tables', () => {
  // 390 px: the partitions table overflows whatever fonts the runner has (820 px was too close to call)
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('a table that scrolls sideways can be reached by keyboard; one that fits adds no tab stop', async ({
    page,
  }) => {
    await page.goto('/app/topics/view/?name=orders&tab=partitions');
    const region = page.getByRole('region', { name: /partitions/i });
    await expect(region).toBeVisible({ timeout: 15_000 });
    await expect(region).toHaveAttribute('tabindex', '0');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(page.locator('.overflow-x-auto[tabindex]')).toHaveCount(0);
  });
});

test('switching cluster from a detail page goes to that section on the other cluster', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=orders');
  await page.getByRole('button', { name: /^Cluster .*Switch cluster$/ }).click();
  const link = page.locator('#ki-cluster-menu a').first();
  await expect(link).toHaveAttribute('href', /^\/app\/topics\/\?c=/);
});

test('Create topic refuses a replication factor below the min.insync.replicas override, and says what to change', async ({
  page,
}) => {
  await page.goto('/app/topics/?create=1');
  const d = page.getByRole('dialog', { name: /Create topic/ });
  await d.getByLabel('Name', { exact: true }).fill('rf-one');
  await d.getByLabel('Replication factor').fill('1');
  await expect(
    d.getByText(/min\.insync\.replicas is 2: use a replication factor of 2 or more/),
  ).toBeVisible();
  await expect(d.getByRole('button', { name: 'Create topic' })).toBeDisabled();
  await d.getByLabel('Name', { exact: true }).fill('x'.repeat(250));
  await expect(d.getByText(/At most 249 characters/)).toBeVisible();
});

test('Produce sends whole messages: "2.5" in Send reads and sends 2', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&produce=1');
  const pr = page.getByRole('dialog', { name: 'Produce message' });
  await pr.getByLabel('Send').fill('2.5');
  await expect(pr.getByRole('button', { name: /Produce 2 messages/ })).toBeVisible();
});

test('the theme switch in Settings shows which theme is selected', async ({ page }) => {
  await page.goto('/app/');
  await page.getByRole('button', { name: /^Settings/ }).click();
  const pressed = page.getByRole('group', { name: /Theme/i }).locator('[aria-pressed="true"]');
  await expect(pressed).toBeVisible();
  // the selected option has a visible fill or indicator behind it, not the bare surface
  const indicatorWidth = await page
    .getByRole('group', { name: /Theme/i })
    .evaluate(
      (g) =>
        (g.querySelector('span[aria-hidden="true"]') as HTMLElement | null)?.getBoundingClientRect()
          .width ?? -1,
    );
  const fill = await pressed.evaluate((b) => getComputedStyle(b).backgroundColor);
  expect(indicatorWidth > 0 || (fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent')).toBe(true);
});

test('chart axis labels and the brokers-online value fit their boxes at 1280', async ({ page }) => {
  await page.goto('/app/');
  await expect
    .poll(() => page.locator('.recharts-cartesian-axis-tick-value').count(), { timeout: 15_000 })
    .toBeGreaterThan(3);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('.recharts-wrapper')].some((w) => {
      const box = w.getBoundingClientRect();
      return [...w.querySelectorAll('.recharts-cartesian-axis-tick-value')].some(
        (t) => t.getBoundingClientRect().right > box.right + 0.5,
      );
    }),
  );
  expect(clipped).toBe(false);
  const value = page.getByText(/^\d+ of \d+$/).first();
  const h = await value.evaluate((e) => e.getBoundingClientRect().height);
  expect(h).toBeLessThan(40); // one 28 px line, not two
});

test('a tooltip still shows after Escape was pressed elsewhere on the page', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&preview=readonly');
  const button = page.getByRole('button', { name: 'Produce message' });
  await expect(button).toBeDisabled({ timeout: 15_000 });
  await page.keyboard.press('Escape'); // e.g. closing a dialog
  const tip = page.locator(`[id="${await button.getAttribute('aria-describedby')}"]`);
  await button.hover({ force: true });
  await expect.poll(() => tip.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
});

test('a copy the browser blocks says "Copy failed" instead of nothing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('blocked')) },
    });
  });
  await page.goto('/app/topics/view/?name=orders');
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Copy failed', { exact: true })).toBeVisible();
});

test('a missing topic stays on its not-found screen through the 10 s re-checks', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/app/topics/view/?name=nosuch&tab=messages&live=1');
  await expect(page.getByText('Topic nosuch not found', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // a re-check used to swap the not-found screen for the full topic page for ~2 s, remounting the tabs
  await page.evaluate(() => {
    const w = window as unknown as { gone: number };
    w.gone = 0;
    new MutationObserver(() => {
      // the topic page (and its Messages tab, which starts the live tail) must never come back
      if (document.body.textContent?.includes('Browse messages')) w.gone++;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.waitForTimeout(25_000); // two re-checks
  expect(await page.evaluate(() => (window as unknown as { gone: number }).gone)).toBe(0);
});

test('a failing topic list keeps its error card through re-checks instead of flashing an empty table', async ({
  page,
}) => {
  await page.goto('/app/topics/');
  await page.getByLabel('Filter topics').fill('(');
  await expect(page.getByText("Couldn't list topics")).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => {
    const w = window as unknown as { flashes: number };
    w.flashes = 0;
    new MutationObserver(() => {
      if (!document.body.textContent?.includes("Couldn't list topics")) w.flashes++;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.waitForTimeout(6_000); // three 2 s polls
  expect(await page.evaluate(() => (window as unknown as { flashes: number }).flashes)).toBe(0);
});

test('the bell and Manage clusters switch screens without reloading the app (chaos and mutes survive)', async ({
  page,
}) => {
  await page.goto('/app/topics/');
  await expect(page.getByRole('link', { name: 'orders' })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => ((window as unknown as { kiAlive: number }).kiAlive = 1));
  await page.getByRole('link', { name: /^Alerts, / }).click();
  await expect(page).toHaveURL(/\/app\/alerts\/$/);
  expect(await page.evaluate(() => (window as unknown as { kiAlive?: number }).kiAlive)).toBe(1);
  await page.getByRole('button', { name: /^Cluster .*Switch cluster$/ }).click();
  await page.locator('#ki-cluster-menu').getByRole('link', { name: 'Manage clusters' }).click();
  await expect(page).toHaveURL(/\/app\/clusters\/$/);
  expect(await page.evaluate(() => (window as unknown as { kiAlive?: number }).kiAlive)).toBe(1);
});

test('switching a new rule to under-replicated partitions resets the lag threshold and name', async ({
  page,
}) => {
  await page.goto('/app/alerts/');
  await page.getByRole('button', { name: 'New rule' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Metric').selectOption('under-replicated');
  await expect(d.getByLabel('Threshold', { exact: true })).toHaveValue('0');
  await expect(d.getByLabel('Name')).not.toHaveValue('Lag too high');
});

test('hot partition offers only topics where a skew warning can appear', async ({ page }) => {
  await page.goto('/app/chaos/');
  const pick = page.getByLabel('Hot partition target');
  await expect(pick.locator('option', { hasText: 'orders' })).toHaveCount(1, { timeout: 15_000 });
  await expect(pick.locator('option', { hasText: 'all topics' })).toHaveCount(0);
  await expect(pick.locator('option', { hasText: /^experiments$/ })).toHaveCount(0);
});

test('"Start from the latest version" seeds the latest even when an older version is compared', async ({
  page,
}) => {
  const seeded = async (to: number) => {
    await page.goto(`/app/schemas/?subject=orders-value&to=${to}&check=1`);
    const d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'Start from the latest version' }).click();
    const box = d.getByRole('textbox').first();
    await expect(box).not.toHaveValue('', { timeout: 15_000 });
    return box.inputValue();
  };
  const latest = await seeded(4);
  expect(await seeded(2)).toBe(latest);
});

test('on a read-only cluster, Delete group on a group with members gives the read-only hint', async ({
  page,
}) => {
  await page.goto('/app/groups/view/?id=order-service&preview=readonly');
  const del = page.getByRole('button', { name: 'Delete group' });
  await expect(del).toBeDisabled({ timeout: 15_000 });
  const tipId = await del.getAttribute('aria-describedby');
  expect(tipId).toBeTruthy();
  await expect(page.locator(`[id="${tipId}"]`)).toHaveText(/Read-only in this version/);
});

test('a double click on Create rule creates one rule', async ({ page }) => {
  await page.goto('/app/alerts/?tab=rules');
  await page.getByRole('button', { name: 'New rule' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill('Only once');
  await d.getByRole('button', { name: 'Create rule' }).dblclick();
  await expect(d).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: /^Only once/ })).toHaveCount(1);
});

test('a JavaScript filter ending in a line comment still runs', async ({ page }) => {
  await page.goto(
    `/app/topics/view/?name=orders&tab=messages&filter=${encodeURIComponent('value.total > 100 // big orders')}`,
  );
  await expect(page.getByText(/of [\d,]+ scanned match/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Syntax error/)).toHaveCount(0);
});

for (const range of ['24h', '7d']) {
  test(`chart axis labels with dates fit their box on the ${range} range`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/app/?range=${range}`);
    await expect
      .poll(() => page.locator('.recharts-cartesian-axis-tick-value').count(), { timeout: 15_000 })
      .toBeGreaterThan(3);
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('.recharts-wrapper')].some((w) => {
        const box = w.getBoundingClientRect();
        return [...w.querySelectorAll('.recharts-cartesian-axis-tick-value')].some(
          (t) => t.getBoundingClientRect().right > box.right + 0.5,
        );
      }),
    );
    expect(clipped).toBe(false);
  });
}

test('Reset offsets: a shift that is not a whole number says so', async ({ page }) => {
  await page.goto('/app/groups/view/?id=fraud-scorer&reset=1');
  const d = page.getByRole('dialog');
  await d.getByLabel('Shift by').check();
  await d.getByLabel('Shift', { exact: true }).fill('2.5');
  await expect(d.getByText(/whole number/)).toBeVisible();
});

test('a masking rule typed with stray spaces still masks; each Remove names its rule', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=payments&tab=messages');
  await page.getByRole('button', { name: /^Masking/ }).click();
  const dialog = page.getByRole('dialog', { name: /Masking/ });
  await dialog.getByLabel('Name').fill('hide merchant ');
  await dialog.getByLabel('Topics').fill(' payments ');
  await dialog.getByLabel('JSON path').fill('$.merchantId');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const table = page.getByRole('table', { name: 'Messages in payments' });
  await expect(table.getByRole('row').nth(2)).toBeVisible({ timeout: 15_000 });
  await table.getByRole('row').nth(1).click();
  const drawer = page.getByRole('dialog', { name: 'Message', exact: true });
  await expect(drawer.getByText(/hide merchant/)).toBeVisible();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /^Masking/ }).click();
  await expect(
    page
      .getByRole('dialog', { name: /Masking/ })
      .getByRole('button', { name: 'Remove hide merchant', exact: true }),
  ).toBeVisible();
});

test('self-host warnings are announced, without an exclamation mark', async ({ page }) => {
  await page.goto('/app/self-host/');
  await page.getByLabel(/Bootstrap servers/).fill('localhost:9092');
  const warn = page.getByRole('status').filter({ hasText: 'Inside the container, localhost' });
  await expect(warn).toBeVisible();
  await expect(warn).not.toContainText('!');
});

test('changing where to start does not leave the previous rows on screen', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  const table = page.getByRole('table', { name: 'Messages in orders' });
  await expect(table.getByRole('row').nth(2)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Start from').selectOption('timestamp');
  await expect(page.getByText('Choose where to start')).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(1); // the header only
});

test('a demo that fails to start drops the loading skeleton and says so once', async ({ page }) => {
  await page.route('**/_next/static/chunks/turbopack-worker-*', (r) => r.abort());
  await page.goto('/app/');
  const msg = page.getByText(/Couldn't start: The simulated cluster stopped/);
  await expect(msg).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.ki-skeleton')).toHaveCount(0);
  await expect(msg).not.toContainText('..');
});

test('at 1024 px the time-range control shows all four ranges', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/app/groups/view/?id=payments-sink');
  const range = page.getByRole('group', { name: 'Time range' });
  await expect(range).toBeVisible({ timeout: 15_000 });
  expect(await range.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
});

test('reprocessing after a generated draft sends the same message each time, and says so', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=payments&tab=messages&produce=1');
  const produce = page.getByRole('dialog', { name: 'Produce message' });
  await produce.getByRole('button', { name: 'Generate from schema' }).click();
  await produce.getByRole('button', { name: 'Cancel' }).click();
  const table = page.getByRole('table', { name: 'Messages in payments' });
  await expect(table.getByRole('row').nth(2)).toBeVisible({ timeout: 15_000 });
  await table.getByRole('row').nth(1).click();
  await page
    .getByRole('dialog', { name: 'Message', exact: true })
    .getByRole('button', { name: 'Reprocess to topic' })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Reprocess message' });
  await expect(drawer.getByText(/the same message each time/)).toBeVisible();
});

test('a double click on Trigger starts chaos once; its progress bar resumes where the incident is', async ({
  page,
}) => {
  await page.goto('/app/chaos/');
  const card = page.locator('article', { hasText: 'Traffic spike' });
  await card.getByRole('button', { name: 'Trigger' }).dblclick();
  await expect(card.getByText('Running', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Couldn't start/)).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: /^Overview/ }).click();
  await page.waitForTimeout(3000);
  await nav.getByRole('link', { name: /^Chaos panel/ }).click();
  const bar = card.locator('.ki-progress');
  await expect(bar).toHaveCount(1, { timeout: 10_000 });
  const delay = await bar.evaluate((e) => parseFloat(getComputedStyle(e).animationDelay));
  expect(delay).toBeLessThanOrEqual(-2);
});

test('Retry now while the agent is unreachable stays in the app instead of reloading into an error page', async ({
  page,
}) => {
  await page.route('**/api/health', (r) => r.abort());
  await page.goto('/app/?preview=disconnected');
  const retry = page.getByRole('button', { name: 'Retry now' }).first();
  await expect(retry).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => ((window as unknown as { kiAlive: number }).kiAlive = 1));
  await retry.click();
  await expect(page.getByText(/Still can't reach the agent/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { kiAlive?: number }).kiAlive)).toBe(1);
});

test('reading from a future time says nothing is that recent, not that the topic is empty', async ({
  page,
}) => {
  await page.goto(
    '/app/topics/view/?name=orders&tab=messages&from=timestamp&ts=2099-01-01T00%3A00',
  );
  await expect(page.getByText(/at or after/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/no messages in its retention window/)).toHaveCount(0);
});

test('a lag rule on a group with no members says it is skipped until the group has members', async ({
  page,
}) => {
  await page.goto('/app/alerts/');
  await page.getByRole('button', { name: 'New rule' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Scope').selectOption('search-indexer');
  await expect(d.getByText(/has no members/)).toBeVisible();
});

test('after a session ends, the sign-in page says why', async ({ page }) => {
  await page.route('**/api/info', (r) =>
    r.fulfill({ json: { mode: 'agent', version: '1', auth: true, signedIn: false, clusters: [] } }),
  );
  await page.goto('/app/sign-in/?next=%2Fapp%2F&reason=expired');
  await expect(page.getByText('Your session ended. Sign in again.')).toBeVisible({
    timeout: 10_000,
  });
});

test('a bad search pattern says to fix the pattern, not to pick a start position', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages&search=(a');
  await expect(page.getByText(/Fix the pattern and search again/)).toBeVisible({ timeout: 15_000 });
});

test('Retry now behind a proxy answering 502 stays in the app too', async ({ page }) => {
  await page.route('**/api/health', (r) => r.fulfill({ status: 502, body: 'Bad gateway' }));
  await page.goto('/app/?preview=disconnected');
  const retry = page.getByRole('button', { name: 'Retry now' }).first();
  await expect(retry).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => ((window as unknown as { kiAlive: number }).kiAlive = 1));
  await retry.click();
  await expect(page.getByText(/Still can't reach the agent/)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { kiAlive?: number }).kiAlive)).toBe(1);
});

test('removing a mask rule or acknowledging an alert from the keyboard keeps focus nearby', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=payments&tab=messages');
  await page.getByRole('button', { name: /^Masking/ }).click();
  const dialog = page.getByRole('dialog', { name: /Masking/ });
  await dialog.getByLabel('Name').fill('tmp');
  await dialog.getByLabel('Topics').fill('payments');
  await dialog.getByLabel('JSON path').fill('$.merchantId');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await dialog.getByRole('button', { name: 'Remove tmp', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Remove tmp', exact: true })).toHaveCount(0);
  // the focus fix runs a frame after the removal
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');

  await page.goto('/app/alerts/');
  const ack = page.getByRole('button', { name: 'Acknowledge' }).first();
  await expect(ack).toBeVisible({ timeout: 15_000 });
  await ack.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Acknowledged/).first()).toBeVisible({ timeout: 5000 });
  // the focus fix runs a frame after the removal
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});

test('a topology highlight that matches nothing says so', async ({ page }) => {
  await page.goto('/app/topology/?highlight=zzz');
  await expect(page.getByText('Nothing matches “zzz”.')).toBeVisible({ timeout: 15_000 });
});
