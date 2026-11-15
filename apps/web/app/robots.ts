import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  // Sitemap line needs an absolute URL: add it once the domain is decided (DECISIONS Q-03).
  return { rules: [{ userAgent: '*', allow: '/' }] };
}
