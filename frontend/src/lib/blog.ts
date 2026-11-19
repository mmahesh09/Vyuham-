import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { cache } from "react";

import matter from "gray-matter";
import { z } from "zod";

/**
 * Blog posts are MDX files in frontend/content/blog/<slug>.mdx with YAML frontmatter.
 * Everything here runs at build time: the blog pages are statically generated, so nothing reads
 * the disk at runtime. A post with `draft: true` shows in `next dev` only.
 */

const CONTENT_DIR = path.join(process.cwd(), "content", "blog");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WORDS_PER_MINUTE = 220;

// YAML reads an unquoted 2026-11-15 as a Date; accept that or a string, keep YYYY-MM-DD.
const isoDate = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
);

const Frontmatter = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(300),
  date: isoDate,
  updated: isoDate.optional(),
  author: z.string().min(1).default("The Vyuham team"),
  tags: z.array(z.string().min(1)).default([]),
  draft: z.boolean().default(false),
  // A file under public/, e.g. /blog/what-is-vyuham/cover.png. Without one, the generated share image is used.
  image: z.string().startsWith("/").optional(),
});

export type PostMeta = z.infer<typeof Frontmatter> & { slug: string; readingMinutes: number };
export type Post = PostMeta & { body: string };

const showDrafts = process.env.NODE_ENV !== "production";

async function readPost(file: string): Promise<Post> {
  const slug = file.replace(/\.mdx$/, "");
  if (!SLUG.test(slug)) {
    throw new Error(`Blog post file name "${file}" must be lowercase words joined by hyphens, like my-first-post.mdx`);
  }
  const raw = await fs.readFile(path.join(CONTENT_DIR, file), "utf8");
  const { data, content } = matter(raw);
  const parsed = Frontmatter.safeParse(data);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "frontmatter"}: ${i.message}`).join("; ");
    throw new Error(`Blog post "${file}" has bad frontmatter: ${problems}`);
  }
  const words = content.split(/\s+/).filter(Boolean).length;
  return { ...parsed.data, slug, body: content, readingMinutes: Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) };
}

const loadAll = cache(async (): Promise<Post[]> => {
  let files: string[];
  try {
    files = (await fs.readdir(CONTENT_DIR)).filter((f) => f.endsWith(".mdx"));
  } catch {
    return [];
  }
  const posts = await Promise.all(files.map(readPost));
  return posts.filter((p) => showDrafts || !p.draft).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
});

/** Published posts (plus drafts in dev), newest first, without their bodies. */
export async function getAllPosts(): Promise<PostMeta[]> {
  return (await loadAll()).map(({ body: _body, ...meta }) => meta);
}

/** One post with its MDX body, or null when there's no such (published) post. */
export async function getPost(slug: string): Promise<Post | null> {
  if (!SLUG.test(slug)) return null;
  return (await loadAll()).find((p) => p.slug === slug) ?? null;
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
