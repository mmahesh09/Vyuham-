import { ArrowRight, FileSpreadsheet, MessageSquareText, Share2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Announcement } from "@/components/marketing/announcement";
import { LazyFilterDemo, LazyFinanceShowcase, LazyStoryFeed, LazySyncCard } from "@/components/marketing/lazy-demos";
import { ColumnsShot } from "@/components/marketing/product-shots";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";
import { body, card, container, delay, h2, quiet, sectionY } from "@/components/marketing/tokens";
import { TryAsk, type TryQuestion } from "@/components/marketing/try-ask";

export const metadata: Metadata = {
  title: "Try Vyuham with sample data",
  description:
    "See how Vyuham answers plain-English questions about business data. Pick a question and get a one-line answer with a chart, using sample data. No sign-up needed.",
  alternates: { canonical: "/try" },
};

const QUESTIONS: TryQuestion[] = [
  {
    q: "Revenue by month",
    answer: "Total revenue is up 27% in October.",
    panel: <LazyStoryFeed />,
  },
  {
    q: "Revenue over the last 30 days",
    answer: "Here is daily revenue for the last 30 days. Switch the range to compare.",
    panel: <LazyFilterDemo />,
  },
  {
    q: "Orders per day",
    answer: "Here are orders per day, from an orders table that syncs with your database.",
    panel: <LazySyncCard />,
  },
];

const STEPS = [
  { icon: FileSpreadsheet, title: "Upload a file", text: "Excel or CSV, or connect PostgreSQL or MySQL. Column types are labelled for you." },
  { icon: MessageSquareText, title: "Ask in plain English", text: "Type something like “Top 5 customers by revenue”." },
  { icon: Share2, title: "Save and share", text: "Pin answers to a dashboard and send a read-only link." },
];

export default function TryPage() {
  return (
    <div className="theme-dark dark flex min-h-screen flex-col overflow-x-clip bg-bg">
      <Reveal />
      <SiteNav variant="bar" />

      <main className="flex-1">
        <section className="relative isolate pb-16 pt-[clamp(48px,8vw,96px)]">
          <div className="glow glow--violet left-1/2 top-0 h-[360px] w-[min(640px,90vw)] -translate-x-1/2" />
          <div className={`${container} flex flex-col items-center text-center`}>
            <Announcement>Sample data · No sign-up</Announcement>
            <h1 className="mt-6 max-w-[16ch] text-balance text-[clamp(36px,6vw,76px)] font-semibold leading-[1.02] tracking-[-0.04em] text-white">
              Ask a spreadsheet. <span className="font-extralight text-highlight">See what comes back.</span>
            </h1>
            <p className={`${body} mt-6 max-w-[52ch]`}>
              This is a small online shop&apos;s sales data. Pick a question below to see the one-line answer and the
              chart that comes with it.
            </p>
          </div>
          <div className="mx-auto mt-12 w-full max-w-[1000px] px-[clamp(16px,5vw,48px)]">
            <TryAsk questions={QUESTIONS} />
          </div>
        </section>

        <section className={`band ${sectionY}`}>
          <div className={`${container} grid items-center gap-12 lg:grid-cols-[5fr_6fr] lg:gap-16`}>
            <div data-animate className="flex flex-col gap-6">
              <h2 className={h2}>
                It reads the file <span className={quiet}>before you ask.</span>
              </h2>
              <p className={`${body} max-w-[44ch]`}>
                Numbers, dates, categories and text are labelled on upload, so your first question can already find the
                right columns.
              </p>
            </div>
            <div data-animate style={delay(120)} className="min-w-0">
              <ColumnsShot />
            </div>
          </div>
        </section>

        <section className={sectionY}>
          <div className="mx-auto w-full max-w-[1360px] px-[clamp(12px,3vw,32px)]">
            <div data-animate className="mx-auto mb-12 flex max-w-[1200px] flex-col gap-4 px-[clamp(4px,2vw,16px)] md:flex-row md:items-end md:justify-between">
              <h2 className={`${h2} max-w-[18ch]`}>
                One export in. <span className={quiet}>A whole dashboard out.</span>
              </h2>
              <p className={`${body} max-w-[40ch]`}>Hover the charts and switch the period to see how the dashboard responds.</p>
            </div>
            <div data-animate style={delay(100)}>
              <LazyFinanceShowcase />
            </div>
            <p className="mt-4 text-center text-[13px] text-white/40">Sample data.</p>
          </div>
        </section>

        <section className={`band ${sectionY}`}>
          <div className={container}>
            <h2 data-animate className={`${h2} mb-12 max-w-[20ch]`}>
              Now try it <span className={quiet}>with your own file.</span>
            </h2>
            <ol className="grid gap-4 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} data-animate style={delay(i * 100)} className={`${card} flex flex-col gap-4 p-6 sm:p-8`}>
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-highlight">
                    <s.icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-white">{s.title}</h3>
                  <p className="text-base font-light leading-relaxed text-white/70">{s.text}</p>
                </li>
              ))}
            </ol>
            <div data-animate className="mt-12 flex flex-wrap items-center gap-3">
              <Link href="/signup" className="btn-primary inline-flex min-h-12 items-center gap-2 rounded-full px-7 text-[16px] font-semibold">
                Upload your first spreadsheet <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
              </Link>
              <span className="text-[14px] text-white/55">Free during the beta, no card needed.</span>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
