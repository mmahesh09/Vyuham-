import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { compileMDX } from "next-mdx-remote/rsc";
import Link from "next/link";
import { notFound } from "next/navigation";
import rehypeShiki from "@shikijs/rehype";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { BlogHero } from "@/components/marketing/blog-hero";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { mdxComponents } from "@/features/blog/mdx-components";
import { PostContents } from "@/features/blog/post-contents";
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

/** The post's level-two headings, with the same ids rehype-slug gives them. */
function sectionsOf(body: string) {
  return [...body.matchAll(/^## (.+)$/gm)].map(([, title]) => ({
    title,
    id: title.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-"),
  }));
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

  // "What is Vyuham? Dashboards from…" reads as a question and a quieter answer.
  const [, question, answer] = post.title.match(/^(.+?\?)\s+(.+)$/) ?? [null, post.title, null];

  return (
    <div className="min-h-screen bg-bg">
      <script
        type="application/ld+json"
        // Escaped like the landing page's JSON-LD: a "</script>" inside a title can't close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <SiteHeader />
      <main>
        <article>
          <BlogHero column="max-w-[1120px]">
            <p className="flex flex-wrap items-center gap-x-2 font-mono text-[12px] font-medium uppercase tracking-[0.08em]">
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span aria-hidden>·</span>
              <span>{post.readingMinutes} min read</span>
              {post.draft && <span className="rounded-[4px] bg-[#2a0d07]/10 px-2 py-0.5">Draft</span>}
            </p>
            <h1 className="max-w-[15ch] font-display text-[clamp(52px,9.5vw,124px)] font-semibold leading-[0.96] tracking-[-0.045em]">
              {question}
              {answer && (
                <span className="mt-5 block max-w-[24ch] text-[clamp(24px,3.4vw,42px)] font-light leading-[1.12] tracking-[-0.025em]">
                  {answer}
                </span>
              )}
            </h1>
          </BlogHero>

          <div className="mx-auto grid max-w-[1120px] gap-12 px-5 pt-[clamp(56px,8vw,96px)] lg:grid-cols-[208px_minmax(0,680px)] lg:justify-between">
            <aside className="hidden lg:block">
              <PostContents sections={sectionsOf(post.body)} />
            </aside>
            <div className="post-body flex min-w-0 flex-col gap-5">{content}</div>
          </div>
        </article>

        <aside className="mx-auto mt-[clamp(72px,10vw,128px)] max-w-[1120px] px-5 pb-[clamp(72px,10vw,128px)]">
          <div className="flex flex-col items-start justify-between gap-8 border-t-2 border-text pt-8 md:flex-row md:items-end">
            <div className="flex flex-col">
              <p className="font-display text-[clamp(34px,5vw,60px)] font-semibold leading-[1.02] tracking-[-0.035em] text-text">
                Bring one spreadsheet.
              </p>
              <p className="font-display text-[clamp(34px,5vw,60px)] font-extralight leading-[1.02] tracking-[-0.03em] text-muted">
                Ask it something.
              </p>
            </div>
            <Link href="/signup" className="btn-primary inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full px-7 text-[16px] font-semibold">
              Create a free account
              <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
            </Link>
          </div>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
