import type { Metadata } from "next";
import Link from "next/link";

import { BlogHero } from "@/components/marketing/blog-hero";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

export const metadata: Metadata = {
  title: "About: who builds it and why",
  description:
    "Vyuham puts analytics and data engineering in one workspace: plain-English answers and dashboards, plus pipelines, SQL, dynamic tables and governance on the same data. Learn who it is for and what the name means.",
  alternates: { canonical: "/about" },
};

const DIFFERENCES = [
  ["Asking and building share one copy of the data", "A pipeline writes a Gold table, and the dashboard reads it. Nobody copies data between tools."],
  ["You can start with a question", "Type “Revenue by month” and you have your first chart, with a one-line headline above it."],
  ["Data work you can see", "Pipelines are steps on a canvas with a log for each one, and dynamic tables keep a history of every refresh."],
  ["The AI shows its work and waits", "It drafts SQL and pipelines from your real tables, checks them first, and nothing it writes runs until a person approves it."],
  ["Access rules hold everywhere", "Masking and column access are applied in the query engine, so they cover queries, exports, shared links and AI requests."],
  ["Your database stays yours", "PostgreSQL and MySQL connections run in read-only sessions. What Vyuham builds lives in your workspace."],
  ["One price per company", "Paid plans will be flat, so the people who ask and the people who build never add to the bill."],
];

const LIMITS = [
  "Plain-English questions follow rules, so they handle totals, rankings, trends and breakdowns better than open-ended questions. Use the SQL Workbench for the rest.",
  "Pipeline steps run SQL. The AI also writes a pandas version of each step, which you can export but Vyuham doesn't run.",
  "Incremental refresh appends rows newer than a date or ID column. It suits tables that only grow; a full refresh handles the rest.",
  "Workload and cost reports measure Vyuham's own work and use rates you enter. They aren't connected to a cloud bill.",
  "Google Sheets isn't connected yet, and there are no notebooks.",
];

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <BlogHero column="max-w-[860px]" variant="amber">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em]">About Vyuham</p>
        <h1 className="font-display text-[clamp(34px,5vw,56px)] font-semibold leading-[1.05] tracking-tight">
          The people who ask and the people who build, on the same data.
        </h1>
        <p className="max-w-[60ch] text-[16.5px] leading-[1.7]">
          In most companies the numbers pass through a spreadsheet, a script, a pipeline tool and a BI tool before anyone reads
          them. Each step keeps its own copy and its own access rules. Vyuham puts the asking and the building in one
          workspace, so a question and the pipeline that answers it read the same tables.
        </p>
      </BlogHero>
      <main className="mx-auto w-full max-w-[860px] flex-1 px-5 pb-24 pt-14">
        <section className="flex flex-col gap-3">
          <h2 className="text-[20px] font-semibold text-text">Who it&apos;s for</h2>
          <p className="max-w-[65ch] text-[16px] leading-[1.75] text-muted">
            Growing companies where some people need answers and someone prepares the data. Founders, owners and managers ask
            questions and read dashboards. Analysts and data engineers build pipelines, SQL and dynamic tables. In a small team,
            that can be the same person on the same afternoon.
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
          <ul className="flex max-w-[65ch] list-disc flex-col gap-2 pl-5 text-[16px] leading-[1.75] text-muted">
            {LIMITS.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="max-w-[65ch] text-[16px] leading-[1.75] text-muted">
            If you need custom data models across many systems or a large orchestration platform, tools like Power BI and Airflow
            go deeper. Vyuham connects to them where it can: a refresh hook lets Airflow, Airbyte or cron trigger its refreshes.
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
