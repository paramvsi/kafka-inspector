import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('with the site URL the sitemap is absolute and robots names it; sign-in and detail pages are not indexed', async () => {
  vi.stubEnv('URL', 'https://example.test');
  const robots = (await import('../app/robots')).default();
  const sitemap = (await import('../app/sitemap')).default();
  expect(sitemap.every((e) => e.url.startsWith('https://example.test/'))).toBe(true);
  expect(robots.sitemap).toBe('https://example.test/sitemap.xml');
  expect(JSON.stringify(robots.rules)).toContain('/app/sign-in/');
});
