import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/site';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    // sign-in and query-param detail pages are empty without a cluster: not worth indexing
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/app/sign-in/', '/app/topics/view/', '/app/groups/view/'],
      },
    ],
    ...(SITE_URL && { sitemap: `${SITE_URL}/sitemap.xml` }),
  };
}
