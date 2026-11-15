import { expect, test } from '@playwright/test';

test('simulated cluster runs in a worker: lag moves, fraud-scorer is stalled, no long tasks', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __long: number[] }).__long = [];
    new PerformanceObserver((l) =>
      l
        .getEntries()
        .forEach((e) => (window as unknown as { __long: number[] }).__long.push(e.duration)),
    ).observe({ type: 'longtask', buffered: false });
  });
  await page.goto('/app/groups/');
  const row = page.getByRole('row', { name: /fraud-scorer/ });
  await expect(row.getByText('Stalled')).toBeVisible({ timeout: 15_000 });
  const lag = row.getByRole('cell').nth(5);
  const first = await lag.innerText();
  await page.evaluate(() => ((window as unknown as { __long: number[] }).__long = []));
  await expect.poll(() => lag.innerText(), { timeout: 5000 }).not.toBe(first);
  await page.waitForTimeout(3000);
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  expect(long.filter((d) => d > 50)).toEqual([]);
});
