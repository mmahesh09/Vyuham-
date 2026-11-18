import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { BlogHero } from "@/components/marketing/blog-hero";
import { PostList, TagFilter } from "@/components/marketing/post-list";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { getAllPosts, getAllTags } from "@/lib/blog";
import { RSS_ALTERNATE } from "@/lib/site";

type Props = { params: Promise<{ tag: string }> };

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getAllTags()).map((tag) => ({ tag }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tag = decodeURIComponent((await params).tag);
  return {
    title: `Posts about ${tag}`,
    description: `Vyuham blog posts tagged "${tag}".`,
    alternates: { canonical: `/blog/tag/${encodeURIComponent(tag)}`, types: RSS_ALTERNATE },
  };
}

export default async function TagPage({ params }: Props) {
  const tag = decodeURIComponent((await params).tag);
  const [posts, tags] = await Promise.all([getAllPosts(), getAllTags()]);
  const tagged = posts.filter((p) => p.tags.includes(tag));
  if (tagged.length === 0) notFound();
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="w-full flex-1">
        <BlogHero>
          <Link href="/blog" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium hover:underline">
            <ArrowLeft className="size-3.5" aria-hidden /> All posts
          </Link>
          <h1 className="font-display text-[clamp(32px,5vw,52px)] font-semibold leading-[1.06] tracking-tight">Posts about {tag}</h1>
        </BlogHero>
        <div className="mx-auto w-full max-w-[760px] px-5 pb-24">
          <TagFilter tags={tags} active={tag} />
          <PostList posts={tagged} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
