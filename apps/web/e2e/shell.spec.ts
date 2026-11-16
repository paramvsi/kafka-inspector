import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const NAV = [
  ['Overview', '/app/', 'Overview'],
  ['Brokers', '/app/brokers/', 'Brokers'],
  ['Topics', '/app/topics/', 'Topics'],
  ['Consumer groups', '/app/groups/', 'Consumer groups'],
  ['Schemas', '/app/schemas/', 'Schemas'],
  ['Topology', '/app/topology/', 'Topology'],
  ['Alerts', '/app/alerts/', 'Alerts'],
  ['Chaos panel', '/app/chaos/', 'Chaos panel'],
  ['Clusters', '/app/clusters/', 'Clusters'],
  [
    'Run on your Kafka',
    '/app/self-host/',
    'Run on your own Kafka',
    'Run Kafka Inspector on your own Kafka',
  ],
] as const;

test('static export contains the shell and the query-param detail routes', () => {
  for (const f of [
    'out/app/index.html',
    'out/app/topics/view/index.html',
    'out/app/groups/view/index.html',
  ]) {
    expect(existsSync(f), f).toBe(true);
  }
});

test('every sidebar item navigates to its stub and marks itself current', async ({ page }) => {
  await page.goto('/app/brokers/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const [label, path, title, heading = title] of NAV as ReadonlyArray<
    readonly [string, string, string, string?]
  >) {
    await nav.getByRole('link', { name: new RegExp(`^${label}( \\d+)?$`) }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    // the name gains a count once data arrives ("Alerts 3"): match both
    await expect(nav.getByRole('link', { name: new RegExp(`^${label}( \\d+)?$`) })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page).toHaveTitle(`${title} · Kafka Inspector`);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(title);
  }
});

test('demo shows the Simulated cluster note on every screen (rule 7)', async ({ page }) => {
  const routes = [
    ...NAV.map((n) => n[1]),
    '/app/topics/view/?name=orders',
    '/app/groups/view/?id=fraud-scorer',
  ];
  for (const path of routes) {
    await page.goto(path);
    await expect(page.getByText('Simulated cluster', { exact: true }), path).toBeVisible({
      timeout: 15_000,
    });
  }
});

test('detail route keeps its section active', async ({ page }) => {
  await page.goto('/app/topics/view/?name=orders');
  await expect(page.getByRole('link', { name: 'Topics', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Topics');
});

test.describe('theme (F-05)', () => {
  test.use({ colorScheme: 'light' });

  test('first visit follows prefers-color-scheme', async ({ page }) => {
    await page.goto('/app/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

test('a menu opened while the cluster boots stays open when live data arrives', async ({
  page,
}) => {
  // hold the agent probe so the boot frame is on screen long enough to open a menu
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/info', async (r) => {
    await held;
    await r.fulfill({ status: 404, body: '' });
  });
  await page.goto('/app/');
  await expect(page.getByText('Checking for a Kafka Inspector agent…')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  const theme = page.getByRole('group', { name: 'Theme' });
  await expect(theme).toBeVisible();
  release();
  await expect(page.getByRole('link', { name: /^Consumer groups/ })).toContainText(/\d/, {
    timeout: 15_000,
  });
  await expect(theme).toBeVisible();
});

test('theme choice persists and applies before any app JavaScript runs (no flash)', async ({
  browser,
}) => {
  // OS says dark, user picks light: the saved choice must win on reload.
  const page = await browser.newPage({ colorScheme: 'dark' });
  await page.goto('/app/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Block every app bundle: only the inline <head> script can set the theme now.
  await page.route('**/_next/static/chunks/**/*.js', (r) => r.abort());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(bg).toBe('rgb(245, 247, 245)'); // --bg light
  await page.close();
});

test('Reduce motion toggle persists and stops the Live pulse', async ({ page }) => {
  await page.goto('/app/');
  // the shell swaps its boot frame for the live one when the cluster is ready; open menus after that
  await expect(page.getByText('Needs attention')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  const box = page.getByRole('checkbox', { name: 'Reduce motion' });
  // Starts checked when the OS already reduces motion; an explicit choice is stored only on change.
  await box.setChecked(false);
  await box.check();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  const dot = page.getByRole('button', { name: 'Live' }).locator('span');
  expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('Live dot pulses unless motion is reduced; pausing makes it static', async ({
  page,
}, info) => {
  await page.goto('/app/');
  const dot = page.getByRole('button', { name: 'Live' }).locator('span');
  const expected = info.project.name === 'reduced-motion' ? 'none' : 'ki-pulse';
  expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe(expected);

  const toggle = page.getByRole('button', { name: /^(Live|Paused)\./ });
  await expect(toggle).toHaveAccessibleName('Live. Pause live updates');
  await expect(toggle).not.toHaveAttribute('aria-pressed');
  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Paused. Resume live updates');
  const paused = page.getByRole('button', { name: 'Paused' }).locator('span');
  expect(await paused.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});
