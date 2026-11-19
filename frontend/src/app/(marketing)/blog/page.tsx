import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BlogHero } from "@/components/marketing/blog-hero";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { formatDate, getAllPosts } from "@/lib/blog";
import { RSS_ALTERNATE } from "@/lib/site";

const description = "Practical guides to understanding your business numbers, building dashboards and getting more from Vyuham.";

export const metadata: Metadata = {
  title: "Blog",
  description,
  alternates: { canonical: "/blog", types: RSS_ALTERNATE },
  openGraph: { type: "website", url: "/blog", title: "Vyuham blog", description },
};

export default async function BlogIndex() {
  const posts = await getAllPosts();

  return (
    <div className="min-h-screen bg-bg">
      <SiteHeader />
      <main>
        <BlogHero column="max-w-[1120px]">
          <h1 className="font-display text-[clamp(52px,9.5vw,124px)] font-semibold leading-[0.96] tracking-[-0.045em]">Blog</h1>
          <p className="max-w-[32ch] text-[clamp(20px,2.6vw,30px)] font-light leading-[1.2] tracking-[-0.015em]">{description}</p>
        </BlogHero>

        <ul className="mx-auto max-w-[1120px] px-5 py-[clamp(56px,8vw,96px)]">
          {posts.map((post) => (
            <li key={post.slug} className="border-t border-line last:border-b">
              <Link href={`/blog/${post.slug}`} className="group grid gap-3 py-8 md:grid-cols-[208px_minmax(0,1fr)_24px] md:gap-8">
                <p className="font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-faint">
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                  <span className="mt-1 block">{post.readingMinutes} min read</span>
                </p>
                <div className="flex min-w-0 flex-col gap-2">
                  <h2 className="font-display text-[clamp(24px,3vw,34px)] font-semibold leading-[1.12] tracking-[-0.02em] text-text group-hover:text-highlight">
                    {post.title}
                  </h2>
                  <p className="max-w-[68ch] text-[16px] leading-[1.65] text-muted">{post.description}</p>
                </div>
                <ArrowRight className="mt-2 hidden size-5 text-faint transition-transform group-hover:translate-x-1 group-hover:text-highlight md:block" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
