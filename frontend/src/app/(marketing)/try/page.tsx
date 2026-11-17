import { ArrowRight, FileSpreadsheet, MessageSquareText, Share2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Announcement } from "@/components/marketing/announcement";
import { LazyFilterDemo, LazyFinanceShowcase, LazyStoryFeed, LazySyncCard } from "@/components/marketing/lazy-demos";
import { MapSection } from "@/components/marketing/map-section";
import { ColumnsShot } from "@/components/marketing/product-shots";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";
import { body, card, container, delay, h2, quiet, sectionY } from "@/components/marketing/tokens";
import { TryAsk, type TryQuestion } from "@/components/marketing/try-ask";

export const metadata: Metadata = {
  title: "Try Vyuham with sample data",
  description:
    "See how Vyuham answers questions about a spreadsheet: pick a question and get the answer plus a chart, using sample data. No sign-up needed.",
  alternates: { canonical: "/try" },
};

const QUESTIONS: TryQuestion[] = [
  {
    q: "Are we selling more than last month?",
    answer: "Yes. Revenue is up 18% on last month, and the last week is ahead of a normal week too.",
    panel: <LazyFilterDemo />,
  },
  {
    q: "What changed this month?",
    answer: "Revenue is up, ad spend is 30% over average, and one client now brings in 22% of revenue.",
    panel: <LazyStoryFeed />,
  },
  {
    q: "Where do our best customers live?",
    answer: "Mumbai and Bengaluru bring 41% of revenue. London is the fastest-growing city this quarter, up 34%.",
    panel: <MapSection bare />,
  },
  {
    q: "Is the sheet still up to date?",
    answer: "Yes. The Google Sheet synced a few minutes ago, and the dashboard refreshes every hour.",
    panel: <LazySyncCard />,
  },
];

const STEPS = [
  { icon: FileSpreadsheet, title: "Upload a file", text: "Excel, CSV or a Google Sheet. Columns are detected for you." },
  { icon: MessageSquareText, title: "Ask in plain English", text: "Type the question the way you'd ask a colleague." },
  { icon: Share2, title: "Save and share", text: "Pin answers to a dashboard and send it as a live link." },
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
              This is a small online shop&apos;s sales sheet. Pick a question below and watch Vyuham answer it in a
              sentence, then show the chart.
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
                Dates, money, categories and IDs are detected on upload, so the first question already gets the right
                chart.
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
              <p className={`${body} max-w-[40ch]`}>Hover the charts, switch the period, flip the currency.</p>
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
