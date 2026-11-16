import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const SCREENS: Array<[string, string | RegExp]> = [
  ['/app/', 'Overview'],
  ['/app/?preview=disconnected', 'Overview'],
  ['/app/brokers/', 'Brokers'],
  ['/app/topics/', 'Topics'],
  ['/app/topics/view/?name=orders', 'orders'],
  ['/app/topics/view/?name=orders&tab=partitions', 'orders'],
  ['/app/topics/view/?name=orders&tab=consumers', 'orders'],
  ['/app/topics/view/?name=orders&tab=config', 'orders'],
  ['/app/topics/view/?name=orders&tab=schema', 'orders'],
  ['/app/topics/view/?name=orders&tab=messages', 'orders'],
  ['/app/groups/', 'Consumer groups'],
  ['/app/groups/view/?id=payments-sink', 'payments-sink'],
  ['/app/groups/view/?id=notify-workers', 'notify-workers'],
  ['/app/schemas/?subject=orders-value&from=3&to=4', 'Schemas'],
  ['/app/clusters/', 'Clusters'],
  ['/app/alerts/', 'Alerts'],
  ['/app/topology/', 'Topology'],
  ['/app/chaos/', 'Chaos panel'],
  ['/app/self-host/', 'Run Kafka Inspector on your own Kafka'],
  ['/app/sign-in/', 'Sign in to Kafka Inspector'],
  ['/', /See what your Kafka is doing/],
];

async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(' | ')}`,
    );
}

for (const [path, heading] of SCREENS) {
  test(`${path} renders on the seeded demo with no serious axe violations`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(1500);
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('dark and light both pass axe on the overview', async ({ page }) => {
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/app/');
    await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.waitForTimeout(1000); // let enter fades finish: axe measures contrast at the current opacity
    expect(await axe(page)).toEqual([]);
  }
});

test('topics: no-results state offers clear filter, include internal and create', async ({
  page,
}) => {
  await page.goto('/app/topics/?q=shipment');
  await expect(page.getByText('No topics match “shipment”')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Include internal topics' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(page.getByRole('link', { name: 'clickstream' })).toBeVisible();
});

test('topic config: edit an override, see it highlighted, reset it to default (F-36)', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=orders&tab=config');
  const row = page.getByRole('row', { name: /^segment\.ms/ });
  await expect(row.getByText('default')).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: 'Edit segment.ms' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit config' });
  await dialog.getByLabel('segment.ms').fill('soon');
  await dialog.getByRole('button', { name: 'Save config' }).click();
  await expect(dialog.getByText('segment.ms must be a whole number.')).toBeVisible();
  await dialog.getByLabel('segment.ms').fill('3600000');
  await dialog.getByRole('button', { name: 'Save config' }).click();
  await expect(dialog).toBeHidden();
  const edited = page.getByRole('row', { name: /^segment\.ms/ });
  await expect(edited.getByText('override')).toBeVisible();
  await expect(edited.getByText('3600000')).toBeVisible();
  await edited.getByRole('button', { name: 'Edit segment.ms' }).click();
  await dialog.getByRole('button', { name: 'Reset to default' }).click();
  await expect(page.getByRole('row', { name: /^segment\.ms/ }).getByText('default')).toBeVisible();
  // read-only: no edit buttons
  await page.goto('/app/topics/view/?name=orders&tab=config&preview=readonly');
  await expect(page.getByText(/overrides · Read-only in this version/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: /^Edit [a-z]+\./ })).toHaveCount(0);
});

test('read-only preview: banner, disabled writes with the hint, self-hosted chrome', async ({
  page,
}) => {
  await page.goto('/app/topics/?preview=readonly');
  await expect(page.getByText('Read-only cluster.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Create topic' })).toBeDisabled();
  await expect(page.getByText('Read-only in this version.').first()).toBeAttached();
  await expect(page.getByRole('link', { name: 'Chaos panel' })).toHaveCount(0);
  await expect(page.getByText('Simulated cluster', { exact: true })).toHaveCount(0);
});

test('disconnected preview: banner, stale values, checks', async ({ page }) => {
  await page.goto('/app/?preview=disconnected');
  await expect(page.getByText('Lost connection to prod-eu-1')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('stale').first()).toBeVisible();
  await expect(
    page.getByText('What we’ve checked').or(page.getByText("What we've checked")),
  ).toBeVisible();
  // only what the browser knows: no invented hosts or broker names
  await expect(page.getByText('3 brokers, checked once the agent answers')).toBeVisible();
  await expect(page.getByText('localhost:8481')).toHaveCount(0);
});

test('create topic → appears and opens its page', async ({ page }) => {
  await page.goto('/app/topics/');
  await page.getByRole('button', { name: 'Create topic' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create topic' });
  await dialog.getByLabel('Name').fill('e2e-shipments');
  await dialog.getByLabel('Replication factor').fill('4');
  await expect(dialog.getByText('Only 3 brokers are online.')).toBeVisible();
  await dialog.getByLabel('Replication factor').fill('3');
  await expect(
    dialog.getByText('--topic e2e-shipments --partitions 12 --replication-factor 3'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Create topic' }).click();
  await expect(page).toHaveURL(/topics\/view\/\?name=e2e-shipments/);
  await expect(page.getByRole('heading', { name: 'e2e-shipments' })).toBeVisible();
});

test('messages open from the keyboard (WCAG 2.1.1)', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  const open = page.getByRole('button', { name: /open message on partition/ }).first();
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Message', exact: true })).toBeVisible();
});

test('a filtered list survives live tail and partition changes (no crash)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app/topics/view/?name=orders&tab=messages&filter=value.total%20%3E%20100');
  await expect(page.getByText(/of [\d,]+ scanned match/)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Live tail').click();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
  await page.getByLabel('Live tail').click();
  await expect(page.getByText(/of [\d,]+ scanned match/)).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
  await expect(page.getByRole('table', { name: 'Messages in orders' })).toBeVisible();
});

test("a group's partition link browses from that group's offsets", async ({ page }) => {
  await page.goto('/app/groups/view/?id=payments-sink');
  const link = page.getByRole('link', { name: /^orders · \d+$/ }).first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(link).toHaveAttribute('href', /from=group&group=payments-sink/);
});

test('a JS filter runs once per change, not in a loop', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __filterRuns: number };
    w.__filterRuns = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, msg: unknown, ...rest: unknown[]) {
      if (msg && typeof msg === 'object' && 'expr' in msg) w.__filterRuns++;
      return (post as (...a: unknown[]) => void).call(this, msg, ...rest);
    };
  });
  await page.goto('/app/topics/view/?name=orders&tab=messages&filter=value.total%20%3E%200');
  await expect(page.getByText(/of [\d,]+ scanned match/)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  const settled = await page.evaluate(
    () => (window as unknown as { __filterRuns: number }).__filterRuns,
  );
  await page.waitForTimeout(1500);
  const later = await page.evaluate(
    () => (window as unknown as { __filterRuns: number }).__filterRuns,
  );
  expect(later - settled).toBe(0);
});

test('produce a valid Avro order, then see it decoded in the drawer', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders&produce=1');
  const drawer = page.getByRole('dialog', { name: 'Produce message' });
  await expect(drawer.getByText(/Valid against orders-value v4/)).toBeVisible({ timeout: 15_000 });
  await drawer.getByLabel('Key').fill('ord_e2e01');
  await drawer
    .getByLabel('Value JSON')
    .fill(
      '{"orderId":"ord_e2e01","customerId":"cus_1","total":"oops","currency":"EUR","status":"PAID","items":[],"email":null,"createdAt":"2026-11-15T14:30:00Z"}',
    );
  await expect(drawer.getByText(/Doesn't match orders-value v4/)).toBeVisible();
  await drawer
    .getByLabel('Value JSON')
    .fill(
      '{"orderId":"ord_e2e01","customerId":"cus_1","total":42.5,"currency":"EUR","status":"PAID","items":[],"email":"me@example.com","createdAt":"2026-11-15T14:30:00Z"}',
    );
  await drawer.getByRole('button', { name: 'Produce 1 message' }).click();
  await page.getByRole('button', { name: 'Show in messages' }).click();
  await expect(page).toHaveURL(/[?&]p=\d+/); // the table behind the drawer shows the message's partition
  const msg = page.getByRole('dialog', { name: 'Message', exact: true });
  await expect(msg.getByText('"ord_e2e01"')).toBeVisible({ timeout: 10_000 });
  await expect(msg.getByText('orders-value v4 · id 112')).toBeVisible();
  await expect(msg.getByText('masked', { exact: true })).toBeVisible();
});

test('JS filter shows N of M scanned match; a syntax error is reported inline', async ({
  page,
}) => {
  await page.goto('/app/topics/view/?name=orders&tab=messages');
  const filter = page.getByLabel(/JavaScript filter/);
  await filter.fill("value.total > 500 && headers.region === 'eu'");
  await filter.press('Enter');
  await expect(page.getByText(/of 100 scanned match/)).toBeVisible({ timeout: 10_000 });
  await filter.fill('value.total >');
  await filter.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'Syntax error' })).toBeVisible();
});

test('poison message: decode error with annotated hex, then reset offsets shift +1 recovers', async ({
  page,
}) => {
  await page.goto('/app/groups/view/?id=fraud-scorer');
  const stalled = page.getByRole('row', { name: /payments · 7/ });
  await expect(stalled.getByText('Stalled')).toBeVisible({ timeout: 15_000 });
  const committed = (await stalled.getByRole('cell').nth(2).innerText()).replace(/,/g, '');
  // Navigate inside the app: a reload would start a new simulator with a different poison offset.
  await stalled.getByRole('link', { name: 'payments · 7' }).click();
  await expect(page.getByRole('row').nth(1)).toContainText(
    Number(committed).toLocaleString('en-US'),
    { timeout: 10_000 },
  );
  await page.getByRole('row').nth(1).click();
  const drawer = page.getByRole('dialog', { name: 'Message', exact: true });
  await expect(drawer.getByText("Couldn't decode the value as Avro")).toBeVisible({
    timeout: 10_000,
  });
  await expect(drawer.getByText('magic byte')).toBeVisible();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await page.goBack();
  await page.goBack();
  await page.getByRole('button', { name: 'Reset offsets' }).click();
  const dialog = page.getByRole('dialog', { name: /Reset offsets/ });
  await expect(
    dialog.getByText(`Skips the message at offset ${Number(committed).toLocaleString('en-US')}`),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply reset to 1 partition' }).click();
  await expect(page.getByText('Offsets reset for fraud-scorer')).toBeVisible();
  await expect(page.getByRole('row', { name: /payments · 7/ }).getByText('Healthy')).toBeVisible({
    timeout: 60_000,
  });
});

test('command palette: ⌘K, type, arrows, Enter navigates; > shows actions only', async ({
  page,
}) => {
  await page.goto('/app/');
  await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('ControlOrMeta+k');
  const pal = page.getByRole('dialog', { name: 'Command palette' });
  await pal.getByRole('combobox').fill('pay');
  await expect(pal.getByRole('option', { name: /payments-sink/ }).first()).toBeVisible();
  await pal.getByRole('combobox').fill('>');
  await expect(pal.getByText('Topics', { exact: true })).toHaveCount(0);
  await pal.getByRole('combobox').fill('payments.dlq');
  await pal.getByRole('combobox').press('Enter');
  await expect(page).toHaveURL(/name=payments.dlq/);
  // the palette must be gone (focus back on the page) before a shortcut can reach the page's handler
  await expect(pal).toBeHidden();
  await expect(async () => {
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    await expect(page).toHaveURL(/\/app\/groups\/$/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
});

test('the decode-error hex dump passes contrast in the light theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ki-theme', JSON.stringify('light')));
  await page.goto('/app/groups/view/?id=fraud-scorer');
  const stalled = page.getByRole('row', { name: /payments · 7/ });
  await expect(stalled.getByText('Stalled')).toBeVisible({ timeout: 15_000 });
  await stalled.getByRole('link', { name: 'payments · 7' }).click();
  await expect(page.getByRole('row').nth(1)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('row').nth(1).click();
  await expect(page.getByRole('region', { name: 'Hex dump' })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await page.waitForTimeout(500); // the drawer's fade-in: mid-fade text reads as low contrast
  expect(await axe(page)).toEqual([]);
});
