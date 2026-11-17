import { ArrowLeft } from "lucide-react";
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
import { Helpful } from "@/features/help/helpful";
import { formatDate } from "@/lib/blog";
import { publicGet, type HelpArticle } from "@/lib/public-api";

type Params = { params: Promise<{ slug: string }> };
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Articles live in the database: built on first visit, then refreshed every minute.
export const revalidate = 60;
export async function generateStaticParams() {
  return [];
}

async function load(slug: string) {
  return SLUG.test(slug) ? publicGet<HelpArticle>(`/kb/articles/${slug}`) : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const a = await load((await params).slug);
  if (!a) return {};
  return { title: a.title, description: a.summary || undefined, alternates: { canonical: `/help/${a.slug}` } };
}

export default async function HelpArticlePage({ params }: Params) {
  const a = await load((await params).slug);
  if (!a) notFound();

  // Staff-written content from the database: compiled as plain Markdown ("md"), never MDX, so it
  // can't contain JSX or JavaScript expressions, and raw HTML is dropped.
  const { content } = await compileMDX({
    source: a.body,
    components: mdxComponents,
    options: {
      blockJS: true,
      mdxOptions: {
        format: "md",
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeSlug, [rehypeShiki, { themes: { dark: "github-dark-default", light: "github-light" }, defaultColor: "dark" }]],
      },
    },
  });

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-5 pb-24 pt-12">
        <Link href="/help" className="inline-flex items-center gap-1.5 text-[13px] text-faint hover:text-text">
          <ArrowLeft className="size-3.5" aria-hidden /> Help center
        </Link>
        <article className="mt-8 flex flex-col gap-6">
          <header className="flex flex-col gap-3 border-b border-line pb-8">
            <h1 className="font-display text-[clamp(30px,4.5vw,42px)] font-semibold leading-[1.1] tracking-tight text-text">{a.title}</h1>
            {a.summary && <p className="text-[17px] leading-[1.65] text-muted">{a.summary}</p>}
            <p className="text-[13px] text-faint">Updated {formatDate(a.updated_at.slice(0, 10))}</p>
          </header>
          <div className="flex flex-col gap-5">{content}</div>
        </article>
        <div className="mt-14 flex flex-col gap-6 border-t border-line pt-8">
          <Helpful slug={a.slug} />
          <p className="text-[14px] text-muted">
            Still stuck?{" "}
            <Link href={`/support/new?from=${encodeURIComponent(`/help/${a.slug}`)}`} className="text-highlight hover:underline">
              Contact support
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
