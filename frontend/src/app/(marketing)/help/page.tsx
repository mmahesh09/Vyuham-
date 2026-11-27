import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { HelpSearch } from "@/features/help/help-search";
import { findTopic, HELP_TOPICS, inTopic } from "@/features/help/topics";
import { publicGet, type HelpSummary } from "@/lib/public-api";

export const metadata: Metadata = {
  title: "Help center: uploading data, dashboards and pipelines",
  description: "Answers to common questions about uploading data, dashboards, pipelines, dynamic tables, governance, sharing and your account.",
  alternates: { canonical: "/help" },
};

type Props = { searchParams: Promise<{ topic?: string }> };

export default async function HelpIndex({ searchParams }: Props) {
  const topic = findTopic((await searchParams).topic);
  const all = (await publicGet<HelpSummary[]>("/kb")) ?? [];
  const articles = topic ? all.filter((a) => inTopic(a, topic)) : all;
  // Group by first tag so the page reads like a table of contents.
  const groups = new Map<string, HelpSummary[]>();
  for (const a of articles) {
    const key = a.tags[0] ?? "general";
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[860px] flex-1 px-5 pb-24 pt-14">
        <div className="flex flex-col gap-4 pb-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Help center</p>
          <h1 className="font-display text-[clamp(34px,5vw,48px)] font-semibold leading-[1.05] tracking-tight text-text">
            {topic ? topic.title : "How can we help?"}
          </h1>
          <p className="max-w-[60ch] text-[16.5px] leading-[1.7] text-muted">
            {topic ? topic.text : "Every answer here started as a real question from a customer."} If yours isn&apos;t covered,{" "}
            <Link href="/support-center#contact" className="text-highlight hover:underline">
              send us a request
            </Link>
            .
          </p>
          <HelpSearch />
        </div>

        <nav aria-label="Help topics" className="mb-10 flex flex-wrap gap-2">
          <TopicChip href="/help" active={!topic}>
            All
          </TopicChip>
          {HELP_TOPICS.map((t) => (
            <TopicChip key={t.id} href={`/help?topic=${t.id}`} active={topic?.id === t.id}>
              {t.title}
            </TopicChip>
          ))}
        </nav>

        {articles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center text-muted">
            {topic ? (
              <>
                <p>No articles in this topic yet.</p>
                <p className="mt-2">
                  <Link href="/help" className="inline-flex items-center gap-1 text-highlight hover:underline">
                    <ArrowLeft className="size-3.5" aria-hidden /> All articles
                  </Link>{" "}
                  ·{" "}
                  <Link href="/support-center#contact" className="text-highlight hover:underline">
                    Ask us directly
                  </Link>
                </p>
              </>
            ) : (
              <p>
                The first articles are being written.{" "}
                <Link href="/support-center#contact" className="text-highlight hover:underline">
                  Ask us directly
                </Link>{" "}
                in the meantime.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-10 sm:grid-cols-2">
            {[...groups.entries()].map(([tag, list]) => (
              <section key={tag} id={tag} className="flex scroll-mt-24 flex-col gap-3">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-faint">{tag}</h2>
                <ul className="flex flex-col gap-2.5">
                  {list.map((a) => (
                    <li key={a.id}>
                      <Link href={`/help/${a.slug}`} className="group flex flex-col">
                        <span className="text-[15.5px] font-medium text-text group-hover:text-highlight">{a.title}</span>
                        {a.summary && <span className="text-[13.5px] leading-relaxed text-muted">{a.summary}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <aside className="mt-16 flex flex-wrap items-center justify-between gap-4 rounded-[18px] border border-line bg-surface p-6">
          <div>
            <p className="font-medium text-text">Something not working right now?</p>
            <p className="text-[14px] text-muted">Check the live system status before you dig in.</p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/status" className="inline-flex min-h-11 items-center text-[14px] font-medium text-highlight hover:underline">
              System status →
            </Link>
            <Link href="/support-center" className="inline-flex min-h-11 items-center text-[14px] font-medium text-highlight hover:underline">
              Support center →
            </Link>
          </div>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}

function TopicChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "inline-flex min-h-9 items-center rounded-full border border-highlight/50 bg-highlight/10 px-3.5 text-[13.5px] font-medium text-highlight"
          : "inline-flex min-h-9 items-center rounded-full border border-line px-3.5 text-[13.5px] text-muted hover:border-line-strong hover:text-text"
      }
    >
      {children}
    </Link>
  );
}
