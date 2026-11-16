import { expect, test } from '@playwright/test';

test('Run on your own Kafka: generates files locally — nothing leaves the browser (F-96)', async ({
  page,
}) => {
  await page.goto('/app/self-host/');
  await expect(
    page.getByRole('heading', { name: 'Run Kafka Inspector on your own Kafka' }),
  ).toBeVisible({ timeout: 15_000 });
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.getByLabel('Cluster name').fill('acme-prod');
  await page.getByLabel('Bootstrap servers').fill('b-1.acme:9096,b-2.acme:9096');
  await page.getByLabel('Password', { exact: false }).count(); // there is no password field
  await expect(page.getByRole('tabpanel')).toContainText(
    'KI_CLUSTERS_0_BOOTSTRAP: "b-1.acme:9096,b-2.acme:9096"',
  );
  await page.getByRole('tab', { name: '.env' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('KI_CLUSTERS_0_SASL_PASSWORD=');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download files' }).click();
  expect((await download).suggestedFilename()).toBe('kafka-inspector.zip');
  const leaked = requests.filter(
    (u) =>
      !u.startsWith('blob:') &&
      !u.startsWith('http://localhost:3100/_next/') &&
      !u.includes('/__next.'),
  );
  expect(leaked).toEqual([]);
  await expect(page.getByLabel('Password')).toHaveCount(0);
});
