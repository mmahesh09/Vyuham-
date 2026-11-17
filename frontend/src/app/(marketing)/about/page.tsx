import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export const metadata: Metadata = {
  title: "About",
  description: "Vyuham is an AI dashboard for small businesses: upload a spreadsheet, ask in plain English, get the answer and a chart.",
  alternates: { canonical: "/about" },
};

const DIFFERENCES = [
  ["Question first", "Home is “What do you want to know?”, not a blank canvas."],
  ["No data modelling", "We describe your columns and spot links between tables for you."],
  ["Plain-English metrics", "No DAX or calculated fields to learn."],
  ["A story, not a wall of charts", "Each card is a one-line insight with the chart behind it."],
  ["Flat pricing", "One price per company, never per seat."],
];

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[860px] flex-1 px-5 pb-24 pt-14">
        <div className="flex flex-col gap-4 pb-10">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">About Vyuham</p>
          <h1 className="font-display text-[clamp(34px,5vw,48px)] font-semibold leading-[1.05] tracking-tight text-text">
            Answers from your spreadsheets, without a data team.
          </h1>
          <p className="max-w-[60ch] text-[16.5px] leading-[1.7] text-muted">
            Small businesses run on spreadsheets, but simple questions about revenue, margins or cash still take hours of
            copying and checking. Business intelligence tools could help, but they&apos;re built for companies with analysts.
            Vyuham is for everyone else.
          </p>
        </div>

        <section className="flex flex-col gap-3 border-t border-line pt-10">
          <h2 className="text-[20px] font-semibold text-text">Who it&apos;s for</h2>
          <p className="max-w-[65ch] text-[16px] leading-[1.75] text-muted">
            Founders, owners and managers at companies of 1 to 100 people: startups tracking revenue and burn, small businesses
            running sales and expenses in Excel, and agencies watching their own numbers.
          </p>
        </section>

        <section className="mt-12 flex flex-col gap-3">
          <h2 className="text-[20px] font-semibold text-text">How we&apos;re different</h2>
          <ul className="flex flex-col">
            {DIFFERENCES.map(([title, text]) => (
              <li key={title} className="border-t border-line py-4">
                <p className="text-[15.5px] font-medium text-text">{title}</p>
                <p className="mt-1 text-[15.5px] leading-[1.7] text-muted">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12 flex flex-col gap-3">
          <h2 className="text-[20px] font-semibold text-text">The name</h2>
          <p className="max-w-[65ch] text-[16px] leading-[1.75] text-muted">
            <em>Vyuham</em> means a formation, an arrangement: scattered data lined up around the one answer that matters. The
            logo is the same idea, two strokes closing around a single point.
          </p>
        </section>

        <p className="mt-14 text-[15.5px] text-muted">
          <Link href="/signup" className="font-medium text-highlight hover:underline">Try Vyuham free</Link>, free during the beta, no card.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
