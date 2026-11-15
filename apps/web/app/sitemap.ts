import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

// Relative URLs: the site's domain is not decided yet (DECISIONS Q-03).
export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/app/', '/app/topics/', '/app/groups/', '/app/topology/', '/app/self-host/'].map(
    (url) => ({ url }),
  );
}
