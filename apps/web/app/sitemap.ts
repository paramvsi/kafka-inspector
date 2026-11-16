import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/site';

export const dynamic = 'force-static';

// Absolute when Netlify provides the site URL (the sitemap protocol requires it); relative in local builds.
export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/app/', '/app/topics/', '/app/groups/', '/app/topology/', '/app/self-host/'].map(
    (path) => ({ url: `${SITE_URL ?? ''}${path}` }),
  );
}
