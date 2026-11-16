// pnpm shots — screenshots of the seeded demo for the landing page and README (run after `pnpm build`).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('../../docs/img', { recursive: true });

const server = spawn('python3', ['-m', 'http.server', '3101', '--directory', 'out'], {
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));
const b = await chromium.launch();
try {
  for (const theme of ['dark', 'light']) {
    const p = await b.newPage({
      viewport: { width: 1280, height: 800 },
      colorScheme: theme,
      deviceScaleFactor: 1,
    });
    await p.goto('http://localhost:3101/app/');
    await p.getByText('Needs attention').waitFor({ timeout: 20000 });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `public/shots/overview-${theme}.png` });
    await p.close();
    // the share card at its own size, so the whole sidebar — with the "Simulated cluster" note — is in it (rule 7)
    if (theme === 'dark') {
      const og = await b.newPage({
        viewport: { width: 1200, height: 630 },
        colorScheme: 'dark',
        deviceScaleFactor: 1,
      });
      await og.goto('http://localhost:3101/app/');
      await og.getByText('Needs attention').waitFor({ timeout: 20000 });
      await og.waitForTimeout(2500);
      await og.screenshot({ path: 'public/shots/og.png' });
      await og.close();
    }
  }
  // README images
  const p = await b.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  const shot = async (path, name, ready) => {
    await p.goto('http://localhost:3101' + path);
    await p.getByText(ready).first().waitFor({ timeout: 20000 });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `../../docs/img/${name}.png` });
  };
  await shot('/app/groups/view/?id=payments-sink', 'group-detail', 'Lag and forecast');
  await shot('/app/topology/', 'topology', 'Consumer groups');
  await shot('/app/chaos/', 'chaos', 'Event log');
  await shot('/app/schemas/?subject=orders-value&from=3&to=4', 'schema-diff', 'Compatibility');
  await p.goto('http://localhost:3101/app/topics/view/?name=orders&tab=messages');
  await p.getByRole('row').nth(1).waitFor({ timeout: 20000 });
  await p.getByRole('row').nth(1).click();
  await p.getByRole('dialog', { name: 'Message' }).getByText('orderId').waitFor();
  await p.waitForTimeout(800);
  await p.screenshot({ path: '../../docs/img/messages.png' });
  process.stdout.write('wrote public/shots/*.png and docs/img/*.png\n');
} finally {
  await b.close();
  server.kill();
}
