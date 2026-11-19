import type { MetadataRoute } from "next";

import { getAllPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const posts = (await getAllPosts()).filter((p) => !p.draft);
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    ...posts.map((p) => ({
      url: `${SITE_URL}/blog/${p.slug}`,
      lastModified: new Date(p.updated ?? p.date),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    { url: `${SITE_URL}/try`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/about`, lastModified, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/support-center`, lastModified, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/help`, lastModified, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/status`, lastModified, changeFrequency: "daily", priority: 0.4 },
    { url: `${SITE_URL}/signup`, lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/login`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}
