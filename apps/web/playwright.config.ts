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
  ],
  webServer: {
    // ponytail: python's static server — swap for `serve` if CI images ever lack python3.
    command: 'python3 -m http.server 3100 --directory out',
    url: 'http://localhost:3100/app/',
    reuseExistingServer: !process.env.CI,
  },
});
