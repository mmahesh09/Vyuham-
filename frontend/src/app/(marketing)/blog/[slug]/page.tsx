import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { compileMDX } from "next-mdx-remote/rsc";
import Link from "next/link";
import { notFound } from "next/navigation";
import rehypeShiki from "@shikijs/rehype";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { mdxComponents } from "@/features/blog/mdx-components";
import { formatDate, getAllPosts, getPost } from "@/lib/blog";
import { RSS_ALTERNATE, SITE_NAME, SITE_URL } from "@/lib/site";

type Params = { params: Promise<{ slug: string }> };

// Every post is built ahead of time; any other slug is a 404.
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getAllPosts()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const post = await getPost((await params).slug);
  if (!post) return {};
  const url = `/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.description,
    authors: [{ name: post.author }],
    keywords: post.tags,
    alternates: { canonical: url, types: RSS_ALTERNATE },
    robots: post.draft ? { index: false, follow: false } : undefined,
    openGraph: {
      type: "article",
      url,
      title: post.title,
      description: post.description,
      siteName: SITE_NAME,
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      authors: [post.author],
      tags: post.tags,
      ...(post.image && { images: [post.image] }),
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

export default async function BlogPost({ params }: Params) {
  const post = await getPost((await params).slug);
  if (!post) notFound();

  const { content } = await compileMDX({
    source: post.body,
    components: mdxComponents,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          rehypeSlug,
          // Dark colours inline (dark is the default theme); globals.css switches to the light ones under .light.
          [rehypeShiki, { themes: { dark: "github-dark-default", light: "github-light" }, defaultColor: "dark" }],
        ],
      },
    },
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    author: { "@type": "Organization", name: post.author },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
    // The generated share image has a hashed URL only Next knows; it reaches crawlers through og:image instead.
    ...(post.image && { image: `${SITE_URL}${post.image}` }),
    keywords: post.tags.join(", "),
  };

  return (
    <div className="min-h-screen bg-bg">
      <script
        type="application/ld+json"
        // Escaped like the landing page's JSON-LD: a "</script>" inside a title can't close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <SiteHeader />
      <main className="mx-auto max-w-[720px] px-5 pb-24 pt-12">
        <Link href="/blog" className="inline-flex items-center gap-1.5 text-[13px] text-faint hover:text-text">
          <ArrowLeft className="size-3.5" aria-hidden /> All posts
        </Link>

        <article className="mt-8 flex flex-col gap-6">
          <header className="flex flex-col gap-4 border-b border-line pb-8">
            <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-faint">
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span aria-hidden>·</span>
              <span>{post.readingMinutes} min read</span>
              <span aria-hidden>·</span>
              <span>{post.author}</span>
              {post.draft && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">Draft: only visible in dev</span>}
            </p>
            <h1 className="font-display text-[clamp(32px,5vw,46px)] font-semibold leading-[1.08] tracking-tight text-text">{post.title}</h1>
            <p className="text-[18px] leading-[1.65] text-muted">{post.description}</p>
          </header>

          <div className="flex flex-col gap-5">{content}</div>
        </article>

        <aside className="mt-16 flex flex-col items-start gap-4 rounded-[18px] border border-line bg-surface p-7">
          <p className="font-display text-[22px] font-semibold leading-snug text-text">Try it on your own spreadsheet</p>
          <p className="text-[15.5px] leading-[1.7] text-muted">
            Upload a CSV or Excel file, ask a question in plain English, and get the answer with a chart.
          </p>
          <Link href="/signup" className="btn-primary inline-flex min-h-12 items-center gap-2 rounded-full px-7 text-[16px] font-semibold">
            Join the beta
            <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
          </Link>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
