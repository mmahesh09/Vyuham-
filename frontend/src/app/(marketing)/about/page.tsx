import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageShell, pageLead, pageTitle, prose, sectionTitle } from "@/components/marketing/page-shell";

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
    <PageShell>
      <p className="eyebrow">About Vyuham</p>
      <h1 className={`${pageTitle} mt-6`}>Answers from your spreadsheets, without a data team.</h1>
      <p className={pageLead}>
        Small businesses run on spreadsheets, but simple questions about revenue, margins or cash still take hours of copying and
        checking. Business intelligence tools could help, but they&apos;re built for companies with analysts. Vyuham is for everyone else.
      </p>

      <section className="mt-16 flex flex-col gap-4">
        <h2 className={sectionTitle}>Who it&apos;s for</h2>
        <p className={prose}>
          Founders, owners and managers at companies of 1 to 100 people: startups tracking revenue and burn, small businesses
          running sales and expenses in Excel, and agencies watching their own numbers.
        </p>
      </section>

      <section className="mt-12 flex flex-col gap-4">
        <h2 className={sectionTitle}>How we&apos;re different</h2>
        <ul className="flex flex-col">
          {DIFFERENCES.map(([title, text]) => (
            <li key={title} className="border-t border-white/10 py-5">
              <p className="text-[16px] font-medium text-white">{title}</p>
              <p className={`${prose} mt-1`}>{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 flex flex-col gap-4">
        <h2 className={sectionTitle}>The name</h2>
        <p className={prose}>
          <em>Vyuham</em> means a formation, an arrangement: scattered data lined up around the one answer that matters. The logo
          is the same idea, two strokes closing around a single point.
        </p>
      </section>

      <div className="mt-16 flex flex-wrap items-center gap-3">
        <Link href="/signup" className="btn-primary inline-flex min-h-12 items-center gap-2 rounded-full px-7 text-[15px] font-semibold">
          Try Vyuham free <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
        </Link>
        <span className="text-[14px] text-white/55">Free during the beta. No card.</span>
      </div>
    </PageShell>
  );
}
