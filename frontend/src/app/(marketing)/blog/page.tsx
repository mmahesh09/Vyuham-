import type { Metadata } from "next";

import { BlogHero } from "@/components/marketing/blog-hero";
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
      <main className="w-full flex-1">
        <BlogHero>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em]">Blog</p>
          <h1 className="font-display text-[clamp(36px,6vw,60px)] font-semibold leading-[1.04] tracking-tight">
            Answers from your spreadsheets
          </h1>
          <p className="max-w-[56ch] text-[17px] font-medium leading-[1.6]">
            Guides for owners and managers of small teams: reporting, dashboards and finding what changed, without a data team.
          </p>
          <p className="text-[13px] font-medium">
            <a href="/blog/rss.xml" className="underline underline-offset-[3px]">
              Subscribe by RSS
            </a>
          </p>
        </BlogHero>

        <div className="mx-auto w-full max-w-[760px] px-5 pb-24">
          {posts.length === 0 ? (
            <p className="py-16 text-center text-muted">The first posts are on their way. Check back soon.</p>
          ) : (
            <>
              <FeaturedPost post={featured} />
              <TagFilter tags={tags} />
              <PostList posts={rest} />
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
