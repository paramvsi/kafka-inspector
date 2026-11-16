import { expect, test } from '@playwright/test';

// Self-hosted mode against a running agent (docker compose -f deploy/docker-compose.dev.yml up).
// Run with: AGENT_URL=http://localhost:8080 AGENT_PASSWORD=dev-password pnpm exec playwright test e2e/agent.spec.ts
const AGENT = process.env.AGENT_URL;
test.skip(!AGENT, 'AGENT_URL not set: agent e2e runs against docker-compose.dev.yml');
test.use({ baseURL: AGENT });

test('self-hosted: sign in, read-only chrome, real topics, groups and decoded messages', async ({
  page,
}) => {
  await page.goto('/app/topics/');
  await expect(page).toHaveURL(/\/app\/sign-in\/\?next=/);
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Wrong username or password/)).toBeVisible();
  await page.getByLabel('Password').fill(process.env.AGENT_PASSWORD ?? 'dev-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/topics\/$/);

  // self-hosted chrome: no chaos, no demo note, read-only badge, writes disabled
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByText('Read-only')).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Chaos panel/ })).toHaveCount(0);
  await expect(page.getByText('Simulated cluster', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create topic' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'orders' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('link', { name: 'orders' }).click();
  await page.getByRole('link', { name: 'Messages', exact: true }).click();
  await page.getByRole('row').nth(1).click();
  const drawer = page.getByRole('dialog', { name: 'Message' });
  await expect(drawer.getByText('"orderId"')).toBeVisible({ timeout: 15_000 });
  await expect(drawer.getByRole('button', { name: 'Reprocess to topic' })).toBeDisabled();
  await drawer.getByRole('button', { name: 'Close' }).click();

  // F-04: a saved filter lives in the agent DB, so it survives a reload and another browser
  await page.goto('/app/topics/view/?name=orders&tab=messages&filter=value.total%20%3E%200');
  await expect(page.getByText(/of [\d,]+ scanned match/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Filter name').fill('e2e paid orders');
  await page.getByLabel('Filter name').press('Enter');
  await expect
    .poll(async () => (await page.request.get('/api/filters')).json())
    .toContainEqual({ name: 'e2e paid orders', expr: 'value.total > 0' });
  await page.reload();
  await expect(page.getByRole('option', { name: 'e2e paid orders' })).toBeAttached({
    timeout: 15_000,
  });

  await nav.getByRole('link', { name: /^Consumer groups/ }).click();
  await expect(page.getByRole('row', { name: /order-service/ })).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole('row', { name: /order-service/ })
    .getByRole('link', { name: 'order-service', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'order-service' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset offsets' })).toBeDisabled();

  // live data over the WebSocket: the overview KPIs arrive
  await nav.getByRole('link', { name: /^Overview/ }).click();
  await expect(page.getByText('Messages in / s')).toBeVisible({ timeout: 30_000 });

  // sign out ends the session
  await nav.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in\//);
  const res = await page.request.get('/api/clusters');
  expect(res.status()).toBe(401);
});

test('a password typed before the sign-in page hydrates is kept and signs in', async ({ page }) => {
  await page.route('**/_next/static/chunks/**/*.js', async (r) => {
    await new Promise((res) => setTimeout(res, 800));
    await r.continue();
  });
  await page.goto('/app/sign-in/', { waitUntil: 'commit' });
  await page
    .locator('input[autocomplete="current-password"]')
    .fill(process.env.AGENT_PASSWORD ?? 'dev-password');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/$/, { timeout: 15_000 });
});

test('signing out in one tab sends the other tab to sign-in promptly (socket closed as "Signed out")', async ({
  context,
}) => {
  const a = await context.newPage();
  await a.goto('/app/');
  await expect(a).toHaveURL(/\/app\/sign-in\/\?next=/);
  await a.getByLabel('Password').fill(process.env.AGENT_PASSWORD ?? 'dev-password');
  await expect(a.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await a.getByRole('button', { name: 'Sign in' }).click();
  await expect(a).toHaveURL(/\/app\/$/);
  await expect(a.getByText('Messages in / s')).toBeVisible({ timeout: 30_000 }); // its socket is up
  // from here only the socket can tell tab A: its HTTP polls (whose 401 would also redirect) are held back
  await a.route('**/api/**', (r) => r.abort());
  const b = await context.newPage();
  await b.goto('/app/topics/');
  await b
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Sign out' })
    .click();
  await expect(a).toHaveURL(/\/app\/sign-in\/\?next=/, { timeout: 5_000 });
});

test('Load more works for every start position (a next page needs only its cursor)', async ({
  page,
}) => {
  await page.goto('/app/');
  await expect(page).toHaveURL(/\/app\/sign-in\/\?next=/);
  await page.getByLabel('Password').fill(process.env.AGENT_PASSWORD ?? 'dev-password');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/$/);
  for (const q of [
    'from=offset&offset=5',
    'from=timestamp&ts=2020-01-01T00:00:00.000Z',
    'from=oldest',
  ]) {
    await page.goto(`/app/topics/view/?name=orders&tab=messages&${q}`);
    const table = page.getByRole('table', { name: 'Messages in orders' });
    await expect(table.getByRole('row').nth(5)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText(/^200 messages/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Couldn't load more/)).toHaveCount(0);
  }
});
