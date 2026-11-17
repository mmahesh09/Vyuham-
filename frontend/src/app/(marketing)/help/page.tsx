import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { HelpSearch } from "@/features/help/help-search";
import { publicGet, type HelpSummary } from "@/lib/public-api";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Help center",
  description: "Answers to common questions about uploading data, building dashboards, sharing and your account.",
  alternates: { canonical: "/help" },
};

export default async function HelpIndex() {
  const articles = (await publicGet<HelpSummary[]>("/kb")) ?? [];
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
        <div className="flex flex-col gap-4 pb-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Help center</p>
          <h1 className="font-display text-[clamp(34px,5vw,48px)] font-semibold leading-[1.05] tracking-tight text-text">How can we help?</h1>
          <p className="max-w-[60ch] text-[16.5px] leading-[1.7] text-muted">
            Every answer here started as a real question from a customer. If yours isn&apos;t covered,{" "}
            <Link href="/support/new" className="text-highlight hover:underline">
              send us a request
            </Link>
            .
          </p>
          <HelpSearch />
        </div>

        {articles.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center text-muted">
            The first articles are being written.{" "}
            <Link href="/support/new" className="text-highlight hover:underline">
              Ask us directly
            </Link>{" "}
            in the meantime.
          </p>
        ) : (
          <div className="grid gap-10 sm:grid-cols-2">
            {[...groups.entries()].map(([tag, list]) => (
              <section key={tag} className="flex flex-col gap-3">
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
          <Link href="/status" className="text-[14px] font-medium text-highlight hover:underline">
            System status →
          </Link>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
