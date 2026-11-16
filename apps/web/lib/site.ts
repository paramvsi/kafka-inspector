/**
 * The site's own address, for absolute URLs (Open Graph, sitemap). Netlify sets `URL` at build time to the
 * site's primary URL, so this follows whatever domain is chosen (DECISIONS Q-03); local builds have none.
 */
export const SITE_URL = process.env.URL || undefined;
