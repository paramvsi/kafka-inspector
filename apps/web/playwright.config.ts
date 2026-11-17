import { defineConfig, devices } from '@playwright/test';

// Runs against the static export (pnpm build first), the same files Netlify and the agent serve.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:3100', viewport: { width: 1280, height: 800 } },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    // MOTION.md acceptance: the smoke suite also runs with reduced motion.
    {
      name: 'reduced-motion',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
    // nightly only (CI on push runs chromium + reduced-motion)
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // python's threaded static server with a real listen backlog and keep-alive (scripts/serve-out.py): the stock
    // `python3 -m http.server` reset connections under parallel workers (10 of 300 in a burst test)
    command: 'python3 scripts/serve-out.py 3100 out',
    url: 'http://localhost:3100/app/',
    reuseExistingServer: !process.env.CI,
  },
});
