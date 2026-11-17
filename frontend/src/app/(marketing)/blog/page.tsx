import type { Metadata } from "next";

import { FeaturedPost, PostList, TagFilter } from "@/components/marketing/post-list";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { getAllPosts, getAllTags } from "@/lib/blog";
import { RSS_ALTERNATE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Blog",
  description: "Guides for small teams turning spreadsheets into answers: dashboards, reporting and plain-English analysis without a data team.",
  alternates: { canonical: "/blog", types: RSS_ALTERNATE },
};

export default async function BlogIndex() {
  const [posts, tags] = await Promise.all([getAllPosts(), getAllTags()]);
  const [featured, ...rest] = posts;
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[760px] flex-1 px-5 pb-24 pt-14">
        <div className="flex flex-col gap-3 border-b border-line pb-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Blog</p>
          <h1 className="font-display text-[clamp(34px,5vw,48px)] font-semibold leading-[1.05] tracking-tight text-text">
            Answers from your spreadsheets
          </h1>
          <p className="max-w-[60ch] text-[16.5px] leading-[1.7] text-muted">
            Guides for owners and managers of small teams: reporting, dashboards and finding what changed, without a data team.
          </p>
          <p className="text-[13px] text-faint">
            <a href="/blog/rss.xml" className="hover:text-text">
              Subscribe by RSS
            </a>
          </p>
        </div>

        {posts.length === 0 ? (
          <p className="py-16 text-center text-muted">The first posts are on their way. Check back soon.</p>
        ) : (
          <>
            <FeaturedPost post={featured} />
            <TagFilter tags={tags} />
            <PostList posts={rest} />
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
