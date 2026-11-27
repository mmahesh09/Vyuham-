/**
 * Public address of the site, for absolute links (sitemap, RSS, canonical URLs, JSON-LD).
 * NEXT_PUBLIC_SITE_URL when set; otherwise Vercel's production domain (set on every Vercel build, previews
 * included, so their canonical links point at the live site); localhost only in local development.
 * Without this, a missing env var made every canonical, sitemap and robots URL say localhost.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/$/, "");
export const SITE_NAME = "Vyuham";

/** The blog feed, for `alternates.types`. A page that sets its own `alternates` replaces the layout's, so spread this in. */
export const RSS_ALTERNATE = { "application/rss+xml": [{ url: "/blog/rss.xml", title: `${SITE_NAME} blog` }] };

/** The company page on LinkedIn (footer, Organization JSON-LD). */
export const LINKEDIN_URL = "https://www.linkedin.com/company/vyuhamai/";
