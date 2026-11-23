import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The signed-in app and the API are private. Password pages use a noindex meta tag instead, so crawlers can read it.
      // Rules match by prefix, so the app's support portal is "/support/" (with the slash): "/support" would
      // also hide the public /support-center.
      disallow: [
        "/api/", "/home", "/dashboards", "/data", "/templates", "/alerts", "/lab", "/metrics", "/profile",
        "/reports", "/sql", "/team", "/support/", "/s/", "/print/", "/invite/", "/internal/",
        "/pipelines", "/dynamic-tables", "/governance", "/usage",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
