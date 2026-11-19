import type { Metadata } from "next";
import Link from "next/link";

import { BlogHero } from "@/components/marketing/blog-hero";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export const metadata: Metadata = {
  title: "About",
  description: "Vyuham turns spreadsheets and databases into dashboards for small businesses. Learn who it is for, how it works and what the name means.",
  alternates: { canonical: "/about" },
};

const DIFFERENCES = [
  ["You start with a question", "Type “Revenue by month” and you have your first chart."],
  ["Your columns are labelled for you", "Vyuham reads each column as a number, date, category or text, and you can correct it."],
  ["Every chart has a headline", "Each card opens with one line about what the numbers show."],
  ["Your database stays yours", "PostgreSQL and MySQL connections run in read-only sessions."],
  ["One price per company", "Paid plans will be flat, so a new teammate never adds to the bill."],
];

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <BlogHero column="max-w-[860px]" variant="amber">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em]">About Vyuham</p>
        <h1 className="font-display text-[clamp(34px,5vw,56px)] font-semibold leading-[1.05] tracking-tight">
          Answers from your spreadsheets, without a data team.
        </h1>
        <p className="max-w-[60ch] text-[16.5px] leading-[1.7]">
          Small businesses run on spreadsheets, and simple questions about revenue or costs still take hours of copying and
          checking. Business intelligence tools can help, but they expect an analyst to run them. Vyuham is for the teams
          that don&apos;t have one.
        </p>
      </BlogHero>
      <main className="mx-auto w-full max-w-[860px] flex-1 px-5 pb-24 pt-14">
        <section className="flex flex-col gap-3">
          <h2 className="text-[20px] font-semibold text-text">Who it&apos;s for</h2>
          <p className="max-w-[65ch] text-[16px] leading-[1.75] text-muted">
            Founders, owners and managers at companies of 1 to 100 people: startups tracking revenue, small businesses running
            sales and expenses in Excel, and agencies watching their own numbers.
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
          <h2 className="text-[20px] font-semibold text-text">What it doesn&apos;t do yet</h2>
          <p className="max-w-[65ch] text-[16px] leading-[1.75] text-muted">
            Ask follows rules today and doesn&apos;t use an AI model, so it handles totals, rankings, trends and breakdowns
            better than open-ended questions. Google Sheets isn&apos;t connected yet either. If you need custom data models
            across many systems, a tool like Power BI will serve you better.
          </p>
        </section>

        <section className="mt-12 flex flex-col gap-3">
          <h2 className="text-[20px] font-semibold text-text">The name</h2>
          <p className="max-w-[65ch] text-[16px] leading-[1.75] text-muted">
            <em>Vyuham</em> comes from the Sanskrit <em>vyūha</em>, a formation or arrangement. For us it means scattered data
            lined up around the one answer that matters. The logo is the same idea, three pieces forming around an open centre.
          </p>
        </section>

        <p className="mt-14 text-[15.5px] text-muted">
          <Link href="/blog/what-is-vyuham" className="font-medium text-highlight hover:underline">Read the full guide to Vyuham</Link>, or{" "}
          <Link href="/signup" className="font-medium text-highlight hover:underline">create a free account</Link>. It&apos;s free during the beta, and you won&apos;t need a card.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
