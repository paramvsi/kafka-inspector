import { expect, test } from '@playwright/test';

test('simulated cluster runs in a worker: lag numbers move, fraud-scorer is stalled, no long tasks', async ({
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
  await page.goto('/app/debug/');
  const fraud = page.locator('[data-group="fraud-scorer"]');
  await expect(fraud.locator('[data-status]')).toHaveText('Stalled', { timeout: 15_000 });
  const lagCell = page.locator('[data-group="fraud-scorer"] [data-lag]');
  const first = await lagCell.innerText();
  // measure only steady-state ticks, after boot
  await page.evaluate(() => ((window as unknown as { __long: number[] }).__long = []));
  await expect.poll(() => lagCell.innerText(), { timeout: 5000 }).not.toBe(first);
  await page.waitForTimeout(3000);
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  expect(long.filter((d) => d > 50)).toEqual([]);
});
