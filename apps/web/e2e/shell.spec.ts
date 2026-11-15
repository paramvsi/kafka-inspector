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
  ['Run on your Kafka', '/app/self-host/', 'Run on your own Kafka'],
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
  for (const [label, path, title] of NAV) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page).toHaveTitle(`${title} · Kafka Inspector`);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(title);
  }
});

test('demo shows the Simulated cluster note (rule 7)', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.getByText('Simulated cluster', { exact: true })).toBeVisible();
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

  await page.getByRole('button', { name: 'Live' }).click();
  const paused = page.getByRole('button', { name: 'Paused' }).locator('span');
  expect(await paused.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});
