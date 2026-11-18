import { expect, test, type Page } from '@playwright/test';

// An agent whose cluster requests never answer: every screen is "still loading", and must not read as
// an empty or all-clear cluster (rule 7) while it is.
const INFO = {
  mode: 'agent',
  version: '1',
  readOnly: true,
  user: { name: 'admin' },
  capabilities: { writes: false, chaos: false, history: true, auth: true, schemaRegistry: false },
  clusters: [
    {
      id: 'local',
      name: 'local',
      status: 'connected',
      brokers: 1,
      kafkaVersion: '4.1',
      schemaRegistry: false,
    },
  ],
};
async function stillLoading(page: Page) {
  await page.route('**/api/info', (r) => r.fulfill({ json: INFO }));
  await page.route(/\/api\/(clusters|alerts)/, () => new Promise(() => {}));
}

test('Alerts still loading says so, not "Nothing is firing" or "0 rules"', async ({ page }) => {
  await stillLoading(page);
  await page.goto('/app/alerts/');
  await expect(page.getByRole('heading', { name: 'Alerts', level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(1500);
  await expect(page.getByText('Nothing is firing')).toHaveCount(0);
  await expect(page.getByText('No alerts in the last 24 hours')).toHaveCount(0);
  await expect(page.getByText(/\b0 rules\b/)).toHaveCount(0);
});

test('Topics still loading shows no "Showing 0 of 0"', async ({ page }) => {
  await stillLoading(page);
  await page.goto('/app/topics/');
  await expect(page.getByRole('heading', { name: 'Topics', level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(1500);
  await expect(page.getByText(/Showing 0 of 0/)).toHaveCount(0);
});

test('a topic still loading shows no "Consumers · 0"', async ({ page }) => {
  await stillLoading(page);
  await page.goto('/app/topics/view/?name=orders');
  await page.waitForTimeout(3000);
  await expect(page.getByText(/Consumers\s*·\s*0/)).toHaveCount(0);
});
