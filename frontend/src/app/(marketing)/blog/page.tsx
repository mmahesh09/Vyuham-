import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/marketing/site-header";
import { formatDate, getAllPosts } from "@/lib/blog";
import { RSS_ALTERNATE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Blog",
  description: "Guides for small teams turning spreadsheets into answers: dashboards, reporting and plain-English analysis without a data team.",
  alternates: { canonical: "/blog", types: RSS_ALTERNATE },
};

export default async function BlogIndex() {
  const posts = await getAllPosts();
  return (
    <div className="min-h-screen bg-bg">
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-5 pb-24 pt-14">
        <div className="flex flex-col gap-3 border-b border-line pb-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Blog</p>
          <h1 className="font-display text-[clamp(34px,5vw,48px)] font-semibold leading-[1.05] tracking-tight text-text">
            Answers from your spreadsheets
          </h1>
          <p className="max-w-[60ch] text-[16.5px] leading-[1.7] text-muted">
            Guides for owners and managers of small teams: reporting, dashboards and finding what changed, without a data team.
          </p>
        </div>

        {posts.length === 0 ? (
          <p className="py-16 text-center text-muted">The first posts are on their way. Check back soon.</p>
        ) : (
          <ul className="flex flex-col">
            {posts.map((post) => (
              <li key={post.slug} className="border-b border-line">
                <Link href={`/blog/${post.slug}`} className="group flex flex-col gap-2.5 py-9">
                  <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-faint">
                    <time dateTime={post.date}>{formatDate(post.date)}</time>
                    <span aria-hidden>·</span>
                    <span>{post.readingMinutes} min read</span>
                    {post.draft && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">Draft</span>}
                  </p>
                  <h2 className="font-display text-[24px] font-semibold leading-snug text-text transition-colors group-hover:text-highlight">
                    {post.title}
                  </h2>
                  <p className="text-[15.5px] leading-[1.7] text-muted">{post.description}</p>
                  {post.tags.length > 0 && (
                    <p className="flex flex-wrap gap-1.5 pt-1">
                      {post.tags.map((t) => (
                        <span key={t} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-faint">
                          {t}
                        </span>
                      ))}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
