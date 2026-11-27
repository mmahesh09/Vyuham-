/** Public address and name of the site, for absolute links (sitemap, RSS, canonical URLs, JSON-LD). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const SITE_NAME = "Vyuham";

/** The blog feed, for `alternates.types`. A page that sets its own `alternates` replaces the layout's, so spread this in. */
export const RSS_ALTERNATE = { "application/rss+xml": [{ url: "/blog/rss.xml", title: `${SITE_NAME} blog` }] };

/** The company page on LinkedIn (footer, Organization JSON-LD). */
export const LINKEDIN_URL = "https://www.linkedin.com/company/vyuhamai/";
