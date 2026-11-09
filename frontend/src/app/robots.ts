import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The signed-in app and the API are private. Password pages use a noindex meta tag instead, so crawlers can read it.
      disallow: ["/api/", "/home", "/dashboards", "/data", "/templates"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
