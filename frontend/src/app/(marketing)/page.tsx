import {
  ArrowRight, BellRing, Check, Code2, Copy, Download, Gauge, GitBranch, Globe, LayoutDashboard, Link2Off, Lock,
  MessageSquareText, MousePointerClick, Plus, RefreshCcwDot, ShieldCheck, Sigma, Sparkles, Workflow, X,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RSS_ALTERNATE } from "@/lib/site";
import { Hero } from "@/components/marketing/hero";
import { LazyFilterDemo, LazyLiveDashboard, LazyStoryFeed, LazySyncCard } from "@/components/marketing/lazy-demos";
import { DATABASE_LOGOS, IntegrationGrid } from "@/components/marketing/integration-grid";
import { MessySheet } from "@/components/marketing/messy-sheet";
import { ParticlesBackground } from "@/components/marketing/particles-background";
import { GovernanceShot, PipelineShot, WorkbenchShot } from "@/components/marketing/platform-shots";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter } from "@/components/marketing/site-footer";
import { body, container, delay, h2, quiet, sectionY } from "@/components/marketing/tokens";
import { LogoMark } from "@/components/layout/logo";
import { Mark } from "@/components/ui/mark";

const SITE_NAME = "Vyuham";
const DESCRIPTION =
  "Analytics and data engineering in one workspace. Ask your data in plain English, build pipelines and self-refreshing tables in SQL, and control who sees what. Free during the beta.";

export const metadata: Metadata = {
  title: "Analytics and Data Engineering in One Workspace",
  description: DESCRIPTION,
  alternates: { canonical: "/", types: RSS_ALTERNATE },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: "Ask your data, and build the pipelines that feed it",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Ask your data, and build the pipelines that feed it",
    description: DESCRIPTION,
  },
};


/** Numbered section label: one accent thread from the first section to the last. */
function Eyebrow({ n, children, className = "" }: { n: string; children: React.ReactNode; className?: string }) {
  return (
    // A span, so it can also sit inside a heading.
    <span className={`eyebrow ${className}`}>
      {n} <b>{children}</b>
    </span>
  );
}

/** Product facts, not invented social proof. */
const FACTS = [
  { label: "Works with", value: "Excel, CSV, PostgreSQL, MySQL" },
  { label: "Query engine", value: "DuckDB, read-only SQL" },
  { label: "Builds", value: "Pipelines and refreshing tables" },
  { label: "Pricing", value: "Free in beta, then one flat price" },
];

/** One primary action across the page: a free account. Same words everywhere so the next step never changes. */
function PrimaryCta({ children = "Start free" }: { children?: React.ReactNode }) {
  return (
    <Link
      href="/signup"
      className="btn-primary inline-flex min-h-12 items-center gap-2 rounded-full px-7 text-[16px] font-semibold"
    >
      {children}
      <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
    </Link>
  );
}

/** The low-commitment path: the sample-data demo, no account. */
function SecondaryCta({ children = "Try it with sample data" }: { children?: React.ReactNode }) {
  return (
    <Link
      href="/try"
      className="btn-ghost inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium"
    >
      <MousePointerClick className="size-4 text-highlight" strokeWidth={2} aria-hidden />
      {children}
    </Link>
  );
}

/** Both actions plus one line of reassurance, used between sections. */
function CtaRow({ note = "Free during the beta. No card needed.", className = "" }: { note?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-start gap-4 ${className}`}>
      <div className="flex flex-wrap items-center gap-3">
        <PrimaryCta />
        <SecondaryCta />
      </div>
      <p className="text-[14px] text-white/55">{note}</p>
    </div>
  );
}

/** Data-handling facts, each backed by a real setting or endpoint. Shown next to the final ask. */
const TRUST = [
  { icon: Lock, text: "Databases are read in read-only sessions, and every query has a time limit" },
  { icon: ShieldCheck, text: "Masking and access rules are applied inside the query engine" },
  { icon: Link2Off, text: "Nothing is public until you create a share link, and you can switch it off" },
  { icon: Download, text: "Download your data or delete your workspace from your profile" },
];

const BETA_INCLUDES = [
  "Excel and CSV uploads, up to 10 MB and 1 million rows per file",
  "PostgreSQL and MySQL connections that refresh hourly or daily",
  "Plain-English questions, dashboards, alerts and scheduled reports",
  "SQL Workbench, pipelines and dynamic tables",
  "Sensitive-data scanning, masking, access rules and the audit log",
  "Workload and cost reports, team invites, share links and PDF export",
];

const MOMENTS: { when: string; who: string; text: React.ReactNode }[] = [
  {
    when: "Monday, 9:02",
    who: "The person who needs the number",
    text: (
      <>
        Your co-founder asks if sales are up. You open four spreadsheets, copy columns into a fifth and fight a #REF!
        error. Forty minutes later the answer is <Mark>“roughly, yes.”</Mark>
      </>
    ),
  },
  {
    when: "Monday, 9:40",
    who: "The person who prepares it",
    text: (
      <>
        The nightly script that cleans the orders export failed on Saturday. Nobody noticed, so the dashboard has shown
        Friday’s numbers all weekend. The cron log says <Mark>“exit code 1.”</Mark>
      </>
    ),
  },
  {
    when: "Three months later",
    who: "Both of you",
    text: (
      <>
        A client asks who can see their customers’ emails. The data sits in a script, a BI tool and two shared drives,
        and <Mark>nobody can give a straight answer.</Mark>
      </>
    ),
  },
];

const STEPS: { title: string; text: React.ReactNode }[] = [
  {
    title: "Connect",
    text: (
      <>
        Upload Excel or CSV, or connect PostgreSQL or MySQL. Every column is labelled as a number, date, category or
        text, and <Mark>you can correct any label.</Mark>
      </>
    ),
  },
  {
    title: "Build",
    text: (
      <>
        Clean and join the data with a pipeline, a SQL query or a dynamic table that <Mark>refreshes on its own.</Mark>{" "}
        Or describe what you need and let the AI draft it.
      </>
    ),
  },
  {
    title: "Ask and share",
    text: (
      <>
        Type “Top 5 customers by revenue” and get <Mark>a one-line answer with the chart.</Mark> Pin it to a dashboard,
        set an alert or send a read-only link.
      </>
    ),
  },
  {
    title: "Govern",
    text: (
      <>
        Find columns with emails, phone numbers or IDs, mask them for the people who shouldn’t see them, and read{" "}
        <Mark>who exported what, and when.</Mark>
      </>
    ),
  },
];

type Feature = { icon: LucideIcon; name: string; text: string; href: string };

/** Every major feature, split by who uses it. Each links to the section that explains it. */
const PLATFORM: { title: string; kind: string; audience: string; intro: string; items: Feature[] }[] = [
  {
    title: "Vyuham",
    kind: "Analytics",
    audience: "For people who need answers",
    intro: "Owners, managers and anyone who asks “how are we doing?”",
    items: [
      { icon: MessageSquareText, name: "Ask in plain English", text: "Totals, rankings and trends, with a one-line answer and the chart.", href: "#analytics" },
      { icon: LayoutDashboard, name: "Dashboards that explain themselves", text: "Every chart opens with its headline. One date filter moves them all.", href: "#dashboards" },
      { icon: Sigma, name: "Shared metrics", text: "Define “revenue” once, test it, and every chart uses the same formula.", href: "#dashboards" },
      { icon: BellRing, name: "Alerts and scheduled reports", text: "Hear when a number crosses a line. Get the PDF or CSV every Monday.", href: "#dashboards" },
      { icon: Globe, name: "Share links and PDF", text: "A read-only view for investors or clients that you can switch off.", href: "#dashboards" },
    ],
  },
  {
    title: "Kaveri",
    kind: "Engineering platform",
    audience: "For people who build data",
    intro: "Analysts and engineers, or the one person who is both.",
    items: [
      { icon: Workflow, name: "Pipelines", text: "Read, clean, check and write Bronze, Silver and Gold tables on a canvas.", href: "#pipelines" },
      { icon: Sparkles, name: "AI Data Engineer", text: "Describe the pipeline. It drafts the steps from your real tables and waits for approval.", href: "#pipelines" },
      { icon: Code2, name: "SQL Workbench", text: "Tabs, autocomplete, query plans, parameters and AI help to write or fix a query.", href: "#workbench" },
      { icon: RefreshCcwDot, name: "Dynamic tables", text: "Tables defined by SQL that refresh on schedule, in dependency order.", href: "#workbench" },
      { icon: GitBranch, name: "Quality checks and lineage", text: "Rules on every table, and a map of what each one was built from.", href: "#pipelines" },
      { icon: ShieldCheck, name: "Governance", text: "Sensitive-data scanning, masking, column access and an audit log.", href: "#governance" },
      { icon: Gauge, name: "Workload and cost", text: "Which queries and pipelines use the most time, and what that costs at your rates.", href: "#governance" },
    ],
  },
];

const OLD_WAY = [
  ["9:02", "Open Sales_FINAL_v3, Invoices and the bank export"],
  ["9:11", "Copy October into a new tab. Then September."],
  ["9:24", "Fix the #REF! in column F. Break column G."],
  ["9:35", "Build a pivot table. Wonder if refunds are in it."],
  ["9:44", "“Roughly yes, I think?”"],
];

const PIPELINE_POINTS = [
  { label: "Steps on a canvas", text: "Read a dataset, remove duplicates, run checks, transform in SQL and write a table. Each step shows its rows." },
  { label: "Medallion layers", text: "Raw reads land in Bronze, cleaned rows in Silver, business tables in Gold." },
  { label: "Failures you can read", text: "Every step keeps its log. Fix the step that failed and retry only that part." },
  { label: "Replace, append or incremental", text: "Incremental writes add rows newer than a date or ID column you choose." },
];

const AI_POINTS = [
  "It reads your real table and column names. If the data you asked about isn’t there, it says so.",
  "Every step it writes is checked against your tables before you see it.",
  "Nothing it drafts runs until a person approves it. A later AI change needs approval again.",
  "Debug a failed run: it reads the logs, explains the error and proposes a checked fix.",
];

const WORKBENCH_POINTS = [
  { label: "SQL Workbench", text: "Open several queries in tabs, autocomplete tables and columns, read the query plan, add {{parameters}} and cancel a slow query. Ask the AI to write, explain, fix or optimize SQL, or turn it into pandas." },
  { label: "Dynamic tables", text: "Save a query as a table and choose how fresh it should be. Vyuham works out what it depends on, refuses loops, refreshes upstream tables first, retries failures and keeps a history of every refresh." },
];

const GOVERNANCE_POINTS = [
  { label: "Find sensitive data", text: "The scanner flags emails, phone numbers, names, addresses, card numbers and government IDs. It stores counts, never the values." },
  { label: "Mask it at the source", text: "Partial, hashed, redacted or hidden, per role. The rule holds in queries, exports, dashboards, shared links and AI requests." },
  { label: "Read the audit log", text: "Who read which dataset, who changed a permission or policy, who exported data, and when." },
  { label: "See what work costs", text: "Rank queries and pipelines by the time they use, spot repeats and idle tables, and set a budget. Costs are estimated from rates you enter." },
];

const DATA_FACTS = [
  { label: "Read-only sessions", text: "Every database connection is opened read-only, and queries have a time limit." },
  { label: "Encrypted password", text: "Your database password is stored encrypted and never shown again." },
  { label: "Your choice of tables", text: "Only the tables you pick are copied into your workspace." },
  { label: "Messy files are fine", text: "One header row and one record per row. Correct a column type once and later charts use the fix." },
];

const COMPARE = [
  { topic: "Where the work lives", them: "A BI tool, a pipeline tool and scripts", us: "One workspace for both" },
  { topic: "Copies of the data", them: "One per tool, drifting apart", us: "One copy, every tool reads it" },
  { topic: "Access rules", them: "Set again in each tool", us: "Set once, enforced on every query" },
  { topic: "Getting a number", them: "Ask whoever built the report", us: "Type the question" },
  { topic: "When a job fails", them: "A cron log someone checks later", us: "The failed step, its log and a retry button" },
  { topic: "Pricing", them: "Several licences, often per person", us: "One price for the whole company" },
];

/** `text` is the plain-text answer used for the FAQPage structured data. */
const FAQ: { q: string; a: React.ReactNode; text: string }[] = [
  {
    q: "Who is Vyuham for?",
    text: "Teams where some people need answers and someone prepares the data, or one person does both. Business users ask questions and read dashboards. Analysts and engineers build pipelines, SQL and dynamic tables on the same data.",
    a: (
      <>
        Teams where some people need answers and someone prepares the data, or one person does both. Business users ask
        questions and read dashboards. Analysts and engineers build <Mark>pipelines, SQL and dynamic tables</Mark> on the
        same data.
      </>
    ),
  },
  {
    q: "How much does it cost?",
    text: "It’s free during the beta. After that, paid plans will be one flat monthly price for your whole company, so adding a teammate never adds to the bill.",
    a: (
      <>
        It’s free during the beta. After that, paid plans will be one flat monthly price for your whole company, so{" "}
        <Mark>adding a teammate never adds to the bill.</Mark>
      </>
    ),
  },
  {
    q: "Do I need a credit card?",
    text: "No. You sign up with your name, email and a password, and there is no card field during the beta.",
    a: (
      <>
        No. You sign up with your name, email and a password, and <Mark>there is no card field</Mark> during the beta.
      </>
    ),
  },
  {
    q: "Can I try it before I sign up?",
    text: "Yes. The Try Vyuham page has a small online shop’s sales data. Pick a question and see the answer and chart without creating an account. Pipelines, SQL and governance open with a free account.",
    a: (
      <>
        Yes. <Link href="/try" className="text-highlight underline-offset-4 hover:underline">Try Vyuham</Link> has a small online shop’s sales data. Pick a question and see the answer and chart <Mark>without creating an account.</Mark> Pipelines, SQL and governance open with a free account.
      </>
    ),
  },
  {
    q: "What kinds of questions can I ask?",
    text: "Totals, averages, counts, rankings and breakdowns over time or by category. “Revenue by month”, “Top 5 products by revenue” and “How many orders in North” all work. For anything more involved, write SQL in the SQL Workbench.",
    a: (
      <>
        Totals, averages, counts, rankings and breakdowns over time or by category.{" "}
        <Mark>“Revenue by month”, “Top 5 products by revenue” and “How many orders in North”</Mark> all work. For
        anything more involved, write SQL in the SQL Workbench.
      </>
    ),
  },
  {
    q: "Can I build data pipelines in Vyuham?",
    text: "Yes. A pipeline reads datasets, removes duplicates, runs quality checks, transforms rows in SQL and writes Bronze, Silver or Gold tables. It runs on demand, hourly or daily in the background, with a log for every step and a retry for the steps that failed.",
    a: (
      <>
        Yes. A pipeline reads datasets, removes duplicates, runs quality checks, transforms rows in SQL and writes Bronze,
        Silver or Gold tables. It runs on demand, hourly or daily in the background, with <Mark>a log for every step</Mark>{" "}
        and a retry for the steps that failed.
      </>
    ),
  },
  {
    q: "What are dynamic tables?",
    text: "Tables defined by a SQL query that Vyuham keeps up to date. You choose how fresh each one should be, or refresh it when a table it reads changes. Refreshes run in dependency order, and every one is recorded with its rows, time and any error. Incremental refresh appends newer rows and suits tables that only grow; anything else uses a full refresh.",
    a: (
      <>
        Tables defined by a SQL query that Vyuham keeps up to date. You choose how fresh each one should be, or refresh it
        when a table it reads changes. Refreshes run <Mark>in dependency order</Mark>, and every one is recorded.
        Incremental refresh appends newer rows and suits tables that only grow; anything else uses a full refresh.
      </>
    ),
  },
  {
    q: "Does Vyuham use AI?",
    text: "In two places, when AI is switched on: SQL help in the SQL Workbench and the AI Data Engineer for pipelines. The AI sees table and column names, never masked or sensitive values. Its SQL is checked against your tables first, and nothing it writes runs until a person approves it. Plain-English questions on dashboards use rules and a real query, so every number comes from your data.",
    a: (
      <>
        In two places, when AI is switched on: SQL help in the SQL Workbench and the AI Data Engineer for pipelines. The
        AI sees table and column names, never masked or sensitive values, and <Mark>nothing it writes runs until a
        person approves it.</Mark> Plain-English questions on dashboards use rules and a real query, so every number
        comes from your data.
      </>
    ),
  },
  {
    q: "How is sensitive data protected?",
    text: "A scanner flags columns with emails, phone numbers, names, addresses, financial details or government IDs. Masking policies and column access then apply inside the query engine, so queries, previews, exports, dashboards, shared links and AI requests all see the masked value. Owners always see full values, and every change is in the audit log.",
    a: (
      <>
        A scanner flags columns with emails, phone numbers, names, addresses, financial details or government IDs.
        Masking and column access then apply <Mark>inside the query engine</Mark>, so queries, exports, dashboards,
        shared links and AI requests all see the masked value. Every change is in the audit log.
      </>
    ),
  },
  {
    q: "Can it replace dbt or Airflow?",
    text: "For SQL pipelines on the data inside Vyuham, often yes: steps, schedules, checks, lineage and retries are built in. Python steps are generated for you to export to your own orchestrator; Vyuham runs the SQL. If you already run Airflow, Airbyte or cron, a refresh hook lets them trigger Vyuham.",
    a: (
      <>
        For SQL pipelines on the data inside Vyuham, often yes: steps, schedules, checks, lineage and retries are built in.
        Python steps are generated for export, and <Mark>Vyuham runs the SQL.</Mark> If you already run Airflow, Airbyte or
        cron, a refresh hook lets them trigger Vyuham.
      </>
    ),
  },
  {
    q: "How are costs calculated?",
    text: "Vyuham measures what your work uses: query and pipeline time, data stored, data scanned and AI tokens. You enter your own rates, and it multiplies them out. It isn’t connected to a cloud bill, so it never shows one; billed cost is marked as not connected.",
    a: (
      <>
        Vyuham measures what your work uses: query and pipeline time, data stored, data scanned and AI tokens. You enter
        your own rates, and it multiplies them out. It isn’t connected to a cloud bill, so <Mark>it never shows one.</Mark>
      </>
    ),
  },
  {
    q: "Can Vyuham change anything in my database?",
    text: "Vyuham connects in read-only sessions and copies the tables you choose into your workspace. Pipelines and dynamic tables write to tables inside Vyuham, never to your database. Your password is stored encrypted. We still recommend a database user that can only read those tables.",
    a: (
      <>
        Vyuham connects in <Mark>read-only sessions</Mark> and copies the tables you choose into your workspace.
        Pipelines and dynamic tables write to tables inside Vyuham, never to your database. We still recommend a database
        user that can only read those tables.
      </>
    ),
  },
  {
    q: "How big can my files be?",
    text: "Up to 10 MB and 1 million rows per Excel or CSV file. For larger data, connect PostgreSQL or MySQL and choose the tables you need.",
    a: (
      <>
        Up to <Mark>10 MB and 1 million rows</Mark> per Excel or CSV file. For larger data, connect PostgreSQL or MySQL and choose the tables you need.
      </>
    ),
  },
  {
    q: "Which databases can I connect?",
    text: "PostgreSQL and MySQL, including MariaDB through the MySQL option. Hosted databases work when they accept connections from the internet. Pick the tables you want and refresh them every hour or every day.",
    a: (
      <>
        <Mark>PostgreSQL and MySQL</Mark>, including MariaDB through the MySQL option. Hosted databases work when they
        accept connections from the internet. Pick the tables you want and refresh them every hour or every day.
      </>
    ),
  },
  {
    q: "Can I export or delete my data?",
    text: "Yes. From your profile you can download a copy of your data. Workspace owners can delete the workspace, which permanently removes its datasets, pipelines and dashboards, and anyone can delete their own account.",
    a: (
      <>
        Yes. From your profile you can <Mark>download a copy of your data.</Mark> Workspace owners can delete the workspace, which permanently removes its datasets, pipelines and dashboards, and anyone can delete their own account.
      </>
    ),
  },
  {
    q: "What happens to my work after the beta?",
    text: "You keep everything you built: datasets, pipelines, dynamic tables, dashboards and share links. Nothing is deleted when the beta ends.",
    a: (
      <>
        <Mark>You keep everything you built</Mark>: datasets, pipelines, dynamic tables, dashboards and share links.
        Nothing is deleted when the beta ends.
      </>
    ),
  },
];

/** Structured data: the product and the FAQ, built from the same content as the page. */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: DESCRIPTION,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free during the beta" },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map(({ q, text }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text },
      })),
    },
  ],
};

function Points({ items }: { items: { label: string; text: string }[] }) {
  return (
    <ul className="flex max-w-[50ch] flex-col gap-4 border-t border-white/10 pt-6">
      {items.map((f) => (
        <li key={f.label} className="grid grid-cols-[20px_1fr] gap-3 text-[16px] font-light leading-relaxed text-white/75">
          <Check className="mt-1 size-4 text-accent" strokeWidth={2.4} aria-hidden />
          <span>
            <strong className="font-semibold text-white">{f.label}.</strong> {f.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Escape "<" so the JSON can never close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }}
      />
      <Reveal />
      <ParticlesBackground className="fixed inset-0 -z-10" quantity={45} color="#ffb37a" size={0.5} staticity={40} ease={70} />

      <main className="overflow-x-clip">
        <Hero />

        {/* At a glance: attached to the hero, compact */}
        <section aria-label="At a glance" className="border-b border-white/[0.06]">
          <dl className={`${container} grid grid-cols-2 gap-x-6 gap-y-8 py-12 lg:grid-cols-4`}>
            {FACTS.map((f, i) => (
              <div key={f.label} data-animate style={delay(i * 70)} className="flex flex-col gap-2 border-l border-white/10 pl-5">
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">{f.label}</dt>
                <dd className="text-[clamp(17px,1.7vw,22px)] font-light tracking-[-0.02em] text-white">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 1 · The problem — black */}
        <section id="problem" className={`scroll-mt-4 ${sectionY}`}>
          <div className={`${container} grid items-center gap-16 lg:grid-cols-[5fr_6fr] lg:gap-20`}>
            <div className="flex flex-col gap-10">
              <div data-animate className="flex flex-col gap-6">
                <h2 className={h2}>
                  <Eyebrow n="01" className="mb-6 flex">The problem</Eyebrow>
                  One set of numbers. <span className={`block ${quiet}`}>Too many places to keep them.</span>
                </h2>
                <p className={`${body} max-w-[46ch]`}>
                  The people who ask the questions work in spreadsheets and a BI tool. The people who prepare the data
                  work in scripts, cron jobs and a separate pipeline tool. Each side waits on the other, and{" "}
                  <Mark>nobody owns the whole picture.</Mark>
                </p>
              </div>
              <ol className="flex flex-col">
                {MOMENTS.map((m, i) => (
                  <li key={m.when} data-animate style={delay(i * 100)} className="border-t border-white/10 py-6">
                    <p className="font-mono text-[13px] text-accent">{m.when} <span className="text-white/45">· {m.who}</span></p>
                    <p className="mt-2 text-[17px] leading-relaxed text-white/80">{m.text}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div data-animate style={delay(150)} className="lg:pl-4">
              <MessySheet />
            </div>
          </div>
        </section>

        {/* 2 · The platform: Vyuham and Kaveri — band */}
        <section id="platform" className={`band relative isolate scroll-mt-4 ${sectionY}`}>
          <div className="glow glow--violet right-[0%] top-[30%] h-[460px] w-[620px]" />
          <div className={container}>
            <div data-animate className="mb-14 grid gap-6 lg:grid-cols-[5fr_6fr] lg:items-end">
              <h2 className={h2}>
                <Eyebrow n="02" className="mb-6 flex">The platform</Eyebrow>
                Two products. <span className={quiet}>One copy of the data.</span>
              </h2>
              <p className={`${body} max-w-[46ch]`}>
                Vyuham is where you ask and read. Kaveri is where you build. What a Kaveri pipeline writes, a Vyuham
                dashboard reads, and what a policy masks stays masked in both. <Mark>Here’s everything in each.</Mark>
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {PLATFORM.map((col, ci) => (
                <div key={col.title} data-animate style={delay(ci * 120)} className="flex flex-col rounded-[16px] border border-white/10 bg-black/40 p-6 sm:p-8">
                  <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-highlight">{col.kind}</p>
                  <h3 className="mt-2 text-[28px] font-semibold tracking-[-0.025em] text-white">{col.title}</h3>
                  <p className="mt-1 text-[16px] text-white/80">{col.audience}</p>
                  <p className="mt-1 text-[15px] text-white/55">{col.intro}</p>
                  <ul className="mt-6 flex flex-col">
                    {col.items.map(({ icon: Icon, name, text, href }) => (
                      <li key={name} className="border-t border-white/10">
                        <a href={href} className="group grid grid-cols-[36px_1fr] gap-3 py-4">
                          <span className="flex size-9 items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.04]">
                            <Icon className="size-4 text-highlight" strokeWidth={2} aria-hidden />
                          </span>
                          <span>
                            <span className="block text-[16px] font-medium text-white group-hover:text-highlight">{name}</span>
                            <span className="block text-[15px] font-light leading-relaxed text-white/65">{text}</span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 3 · Vyuham · Analytics: the same question, two ways — black */}
        <section id="analytics" className={`relative isolate scroll-mt-4 ${sectionY}`}>
          <div className={container}>
            <div data-animate className="flex flex-col gap-6">
              <Eyebrow n="03">Vyuham · Analytics</Eyebrow>
              <p className="max-w-[22ch] text-[clamp(40px,5.6vw,76px)] font-extralight leading-[1.04] tracking-[-0.03em] text-white">
                “Are we selling more than last month?”
              </p>
              <p className={`${body} max-w-[56ch]`}>
                Your co-founder’s question, answered twice. On the left, the spreadsheet routine most teams know too well.
                On the right, you type <Mark>“Revenue by month”</Mark> and read the result.
              </p>
            </div>

            <div className="mt-16 grid gap-12 md:grid-cols-2 md:gap-16">
              <div data-animate>
                <div className="mb-6 flex items-baseline justify-between border-b border-white/10 pb-4">
                  <h3 className="text-xl font-light text-white/55">The spreadsheet way</h3>
                  <span className="font-mono text-sm text-white/45">42 min</span>
                </div>
                <ol className="flex flex-col gap-4">
                  {OLD_WAY.map(([t, s]) => (
                    <li key={t} className="grid grid-cols-[3rem_1fr] sm:grid-cols-[3.5rem_1fr] gap-3 text-[16px] text-white/50">
                      <span className="font-mono text-[13px] leading-6 text-white/35">{t}</span>
                      <span className="leading-6">{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div data-animate style={delay(120)}>
                <div className="mb-6 flex items-baseline justify-between border-b-2 border-accent pb-4">
                  <h3 className="text-xl font-semibold text-white">With {SITE_NAME}</h3>
                  <span className="font-mono text-sm text-accent">Same minute</span>
                </div>
                <ol className="flex flex-col gap-4">
                  <li className="grid grid-cols-[3rem_1fr] sm:grid-cols-[3.5rem_1fr] gap-3 text-[16px] text-white">
                    <span className="font-mono text-[13px] leading-6 text-highlight">9:02</span>
                    <span className="leading-6">Type “Revenue by month”.</span>
                  </li>
                  <li className="grid grid-cols-[3rem_1fr] sm:grid-cols-[3.5rem_1fr] gap-3 text-[16px] text-white">
                    <span className="font-mono text-[13px] leading-6 text-highlight">9:02</span>
                    <span className="leading-6">
                      <Mark>Total revenue up 27% in October.</Mark>
                    </span>
                  </li>
                </ol>
                <p className="mt-6 text-[15px] text-white/50">With the line chart underneath, ready to pin to a dashboard.</p>
              </div>
            </div>

            <div data-animate className="mt-20" style={delay(100)}>
              <LazyLiveDashboard />
              <p className="mt-4 text-center text-[13px] text-white/40">Sample data, animated to show the layout. Your dashboards update when a file is replaced, a table syncs or a pipeline writes.</p>
              <div className="mt-8 flex justify-center">
                <SecondaryCta>Ask the sample data a question</SecondaryCta>
              </div>
            </div>
          </div>
        </section>

        {/* 4 · Vyuham · Dashboards and day to day — band */}
        <section id="dashboards" className={`band scroll-mt-4 ${sectionY}`}>
          <div className={container}>
            <div className="grid items-center gap-16 lg:grid-cols-[5fr_6fr]">
              <div data-animate className="flex flex-col gap-6">
                <Eyebrow n="04">Vyuham · Dashboards</Eyebrow>
                <h2 className={h2}>
                  Monday morning, <span className={quiet}>already explained.</span>
                </h2>
                <p className={`${body} max-w-[42ch]`}>
                  Every chart carries its headline. Revenue up 27%. Ad spend up 36%. One client at 22% of revenue.{" "}
                  <Mark>You read the sentence first and open the chart for the detail.</Mark>
                </p>
                <p className={`${body} max-w-[42ch]`}>
                  Define a metric like “revenue” once and every chart uses it. Set an alert for when it drops, or have the
                  dashboard sent as a PDF every Monday.
                </p>
              </div>
              <div data-animate style={delay(120)}>
                <LazyStoryFeed />
              </div>
            </div>

            <div className="mt-16 grid gap-4 md:grid-cols-[3fr_2fr]">
              <div data-animate className="flex min-h-[300px] flex-col gap-6 rounded-[16px] border border-white/10 bg-black/40 p-6 sm:p-8">
                <div>
                  <h3 className="text-[24px] font-semibold tracking-[-0.025em] text-white">Your data keeps changing. So does the dashboard.</h3>
                  <p className="mt-2 max-w-[48ch] text-base font-light leading-relaxed text-white/65">
                    Connected tables refresh every hour or every day, and pipelines write fresh tables on their schedule.
                    Upload a new export over the old one and <Mark>your charts stay in place.</Mark>
                  </p>
                </div>
                <LazySyncCard />
              </div>
              <div data-animate style={delay(80)} className="flex min-h-[300px] flex-col gap-5 rounded-[16px] border border-white/10 bg-black/40 p-6 sm:p-8">
                <div>
                  <h3 className="text-[24px] font-semibold tracking-[-0.025em] text-white">Change the date once.</h3>
                  <p className="mt-2 text-base font-light leading-relaxed text-white/65">
                    Date and category filters apply to <Mark>every chart on the page</Mark>. Try it.
                  </p>
                </div>
                <LazyFilterDemo />
              </div>
              <div data-animate className="flex flex-col justify-between gap-8 rounded-[16px] bg-accent p-6 text-[#160f0a] sm:p-8 md:col-span-2 md:flex-row md:items-end md:p-10">
                <div>
                  <h3 className="text-[clamp(24px,2.6vw,32px)] font-semibold leading-[1.1] tracking-[-0.025em]">
                    Send the board update as a link, <span className="font-light">not a 30-slide deck.</span>
                  </h3>
                  <p className="mt-3 max-w-[56ch] text-base leading-relaxed text-[#160f0a]/75">
                    Investors, clients and teammates open a read-only view. Masked columns stay masked for them, and you
                    can switch a link off any time.
                  </p>
                </div>
                <div className="flex w-full min-w-0 max-w-[380px] items-center gap-2 rounded-full bg-[#160f0a] py-1.5 pl-4 pr-1.5 text-[13px] text-white/80">
                  <Globe className="size-4 shrink-0 text-highlight" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">yourapp.com/s/october-board-update</span>
                  <span className="flex size-8 items-center justify-center rounded-full bg-accent text-[#160f0a]">
                    <Copy className="size-3.5" strokeWidth={2.2} aria-hidden />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5 · Kaveri · Pipelines and the AI Data Engineer — black, media left */}
        <section id="pipelines" className={`relative isolate scroll-mt-4 ${sectionY}`}>
          <div className="glow glow--lilac right-[-5%] top-[10%] h-[380px] w-[520px]" />
          <div className={container}>
            <div className="grid items-center gap-16 lg:grid-cols-[6fr_5fr]">
              <div data-animate className="order-2 lg:order-1">
                <PipelineShot />
                <p className="mt-4 text-center text-[13px] text-white/40">Sample run. Each step shows the rows it produced.</p>
              </div>
              <div data-animate className="order-1 flex flex-col gap-6 lg:order-2" style={delay(120)}>
                <Eyebrow n="05">Kaveri · Pipelines</Eyebrow>
                <h2 className={h2}>
                  The nightly script, <span className={quiet}>where everyone can see it.</span>
                </h2>
                <p className={`${body} max-w-[44ch]`}>
                  Build the clean-up and the joins as steps on a canvas. They run in the background on demand, every hour
                  or every day, and <Mark>a failed step tells you why.</Mark>
                </p>
                <Points items={PIPELINE_POINTS} />
              </div>
            </div>

            <div data-animate className="mt-16 grid gap-8 rounded-[16px] border border-white/10 bg-white/[0.03] p-6 sm:p-8 lg:grid-cols-[5fr_6fr] lg:items-start">
              <div>
                <p className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-highlight">
                  <Sparkles className="size-4" aria-hidden /> Kaveri · AI Data Engineer
                </p>
                <h3 className="mt-3 text-[clamp(24px,2.6vw,32px)] font-semibold leading-[1.1] tracking-[-0.025em] text-white">
                  Describe the pipeline. <span className="font-light text-white/70">Approve it before it runs.</span>
                </h3>
                <p className="mt-4 max-w-[46ch] rounded-[12px] border border-white/10 bg-white/[0.03] p-4 font-mono text-[13px] leading-relaxed text-white/70">
                  “Every day, read orders, remove duplicates, check customer IDs, join customers and write revenue by region
                  to a Gold table.”
                </p>
              </div>
              <ul className="flex flex-col gap-4">
                {AI_POINTS.map((p) => (
                  <li key={p} className="grid grid-cols-[20px_1fr] gap-3 text-[16px] font-light leading-relaxed text-white/75">
                    <Check className="mt-1 size-4 text-accent" strokeWidth={2.4} aria-hidden />
                    {p}
                  </li>
                ))}
                <li className="text-[13px] leading-relaxed text-white/45">
                  AI features work when they’re switched on for your workspace. Python versions of steps are generated for
                  export; Vyuham runs the SQL.
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* 6 · Kaveri · SQL Workbench and dynamic tables — band, media right */}
        <section id="workbench" className={`band scroll-mt-4 ${sectionY}`}>
          <div className={`${container} grid items-center gap-16 lg:grid-cols-[5fr_6fr]`}>
            <div data-animate className="flex flex-col gap-6">
              <Eyebrow n="06">Kaveri · SQL and dynamic tables</Eyebrow>
              <h2 className={h2}>
                Write the query once. <span className={quiet}>Keep the result fresh.</span>
              </h2>
              <p className={`${body} max-w-[44ch]`}>
                The SQL Workbench reads every dataset in your workspace, read-only, with a time limit on each query. When a
                query is worth keeping, <Mark>save it as a table that refreshes itself.</Mark>
              </p>
              <Points items={WORKBENCH_POINTS} />
            </div>
            <div data-animate style={delay(120)}>
              <WorkbenchShot />
            </div>
          </div>
        </section>

        {/* 7 · Kaveri · Governance and cost — black, media left */}
        <section id="governance" className={`scroll-mt-4 ${sectionY}`}>
          <div className={`${container} grid items-center gap-16 lg:grid-cols-[6fr_5fr]`}>
            <div data-animate className="order-2 lg:order-1">
              <GovernanceShot />
            </div>
            <div data-animate className="order-1 flex flex-col gap-6 lg:order-2" style={delay(120)}>
              <Eyebrow n="07">Kaveri · Governance and cost</Eyebrow>
              <h2 className={h2}>
                Decide who sees what. <span className={quiet}>Once.</span>
              </h2>
              <p className={`${body} max-w-[44ch]`}>
                The query engine applies the rules before any row leaves it, so a viewer gets the masked value in
                a chart, an export and <Mark>every AI request.</Mark>
              </p>
              <Points items={GOVERNANCE_POINTS} />
            </div>
          </div>
        </section>

        {/* 8 · How it works — band, four steps */}
        <section id="how-it-works" className={`band relative isolate scroll-mt-4 ${sectionY}`}>
          <div className="glow glow--lilac left-[-5%] top-[20%] h-[380px] w-[520px]" />
          <div className={container}>
            <div data-animate className="mb-14 grid gap-6 lg:grid-cols-[5fr_6fr] lg:items-end">
              <h2 className={h2}>
                <Eyebrow n="08" className="mb-6 flex">How it works</Eyebrow>
                From raw tables to answers <span className={quiet}>in one workspace.</span>
              </h2>
              <p className={`${body} max-w-[46ch]`}>
                Everything happens in your browser, on one copy of your data. Builders shape it, everyone else{" "}
                <Mark>asks it questions</Mark>, and the same access rules cover both.
              </p>
            </div>
            <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li
                  key={s.title}
                  data-animate
                  style={delay(i * 100)}
                  className="flex flex-col gap-4 rounded-[16px] border border-white/10 bg-black/40 p-6 sm:p-8"
                >
                  <span className="font-mono text-[13px] text-accent">Step {i + 1}</span>
                  <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-white">{s.title}</h3>
                  <p className="text-base font-light leading-relaxed text-white/70">{s.text}</p>
                </li>
              ))}
            </ol>
            <CtaRow className="mt-12" note="The sample shows the asking side, with no sign-up. Building starts with a free account." />
          </div>
        </section>

        {/* 9 · Your data — black, integration visual */}
        <section id="databases" className={`scroll-mt-4 ${sectionY}`}>
          <div className={container}>
            <div data-animate className="mb-14 grid gap-6 lg:grid-cols-[5fr_6fr] lg:items-end">
              <h2 className={`${h2} max-w-[18ch]`}>
                <Eyebrow n="09" className="mb-6 flex">Your data</Eyebrow>
                Bring files or a database. <span className={quiet}>Vyuham only reads.</span>
              </h2>
              <p className={`${body} max-w-[46ch]`}>
                Upload the export from your accounting tool or CRM, or point Vyuham at PostgreSQL or MySQL and choose the
                tables to refresh. In the SQL Workbench, <Mark>join a synced table with an uploaded CSV.</Mark>
              </p>
            </div>
            <div data-animate style={delay(100)} className="dark mx-auto max-w-[920px]">
              <IntegrationGrid
                logos={DATABASE_LOGOS}
                mark={<LogoMark />}
                label="Vyuham connects to PostgreSQL, MySQL and MariaDB, including databases hosted on Supabase, Neon, DigitalOcean, Google Cloud, Render, Railway and Vultr."
              />
            </div>
            <dl data-animate style={delay(160)} className="mt-14 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {DATA_FACTS.map((f) => (
                <div key={f.label} className="flex flex-col gap-2 border-l border-white/10 pl-5">
                  <dt className="text-[16px] font-semibold text-white">{f.label}</dt>
                  <dd className="text-[15px] font-light leading-relaxed text-white/65">{f.text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-10 max-w-[72ch] text-[13px] leading-relaxed text-white/40">
              PostgreSQL and MySQL are the supported connection types, and MariaDB connects through the MySQL option. The
              other logos are examples of services that host these databases. They aren’t partners or endorsements.
            </p>
          </div>
        </section>

        {/* 10 · Compared — band, sharp editorial table */}
        <section id="compare" className={`band scroll-mt-4 ${sectionY}`}>
          <div className={container}>
            <div data-animate className="mb-14 grid gap-6 lg:grid-cols-[5fr_6fr] lg:items-end">
              <h2 className={h2}>
                <Eyebrow n="10" className="mb-6 flex">Compared</Eyebrow>
                “We already have <span className={quiet}>a BI tool and some scripts.”</span>
              </h2>
              <div className="flex flex-col gap-4">
                <p className={`${body} max-w-[46ch]`}>
                  Most teams do. The trouble starts in the gaps between them: a copy of the data in each tool, access rules
                  set three times, and a failed job nobody sees.
                </p>
                <p className={`${body} max-w-[46ch]`}>
                  Vyuham puts the building and the asking <Mark>on one copy of the data</Mark>. Tools like Power BI and
                  Airflow go deeper on their own; Vyuham suits teams that want both in one place.
                </p>
              </div>
            </div>
            <p className="mb-3 text-[13px] text-white/45 md:hidden">Swipe the table sideways to compare →</p>
            <div data-animate data-lenis-prevent-horizontal className="-mx-[clamp(16px,5vw,48px)] overflow-x-auto px-[clamp(16px,5vw,48px)]">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <caption className="sr-only">{SITE_NAME} compared with a separate BI tool, pipeline tool and scripts</caption>
                <thead>
                  <tr className="border-b-2 border-white">
                    <th scope="col" className="w-[26%] py-4 pr-6 text-sm font-normal text-white/45"><span className="sr-only">Topic</span></th>
                    <th scope="col" className="py-4 pr-6 text-sm font-normal text-white/45">BI tool + pipeline tool + scripts</th>
                    <th scope="col" className="bg-accent/10 px-6 py-4 text-sm font-semibold text-accent">{SITE_NAME}</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map((row) => (
                    <tr key={row.topic} className="border-b border-white/10">
                      <th scope="row" className="py-6 pr-6 text-base font-semibold text-white">{row.topic}</th>
                      <td className="py-6 pr-6 text-base font-light text-white/45">
                        <span className="inline-flex items-center gap-2.5"><X className="size-4 shrink-0" aria-hidden />{row.them}</span>
                      </td>
                      <td className="bg-accent/10 px-6 py-6 text-[17px] font-medium text-white">
                        <span className="inline-flex items-center gap-2.5"><Check className="size-5 shrink-0 text-accent" strokeWidth={2.4} aria-hidden />{row.us}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CtaRow className="mt-12" note="Free during the beta. Start with the file or database you already have." />
          </div>
        </section>

        {/* 11 · Pricing — black, oversized number as the breathing moment */}
        <section id="pricing" className={`scroll-mt-4 ${sectionY}`}>
          <div className={`${container} grid items-end gap-12 md:grid-cols-[auto_1fr] md:gap-20`}>
            <p data-animate className="text-lit text-[clamp(112px,22vw,280px)] font-extralight leading-[0.8] tracking-[-0.06em]" aria-label="Zero dollars">
              $0
            </p>
            <div data-animate style={delay(120)} className="flex max-w-[44ch] flex-col items-start gap-6 pb-2">
              <Eyebrow n="11">Pricing</Eyebrow>
              <h2 className="text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.08] tracking-[-0.03em] text-white">
                Free while we’re in beta.
              </h2>
              <p className={body}>
                We’re building this with our first users, so it’s free while we do. After that: one flat monthly price
                for your whole company. <Mark>Never per seat</Mark>, so the people who ask and the people who build share
                one bill.
              </p>
              <div className="w-full border-t border-white/10 pt-6">
                <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-faint">Included in the beta</p>
                <ul className="mt-4 flex flex-col gap-3">
                  {BETA_INCLUDES.map((item) => (
                    <li key={item} className="grid grid-cols-[20px_1fr] gap-3 text-[16px] font-light leading-relaxed text-white/80">
                      <Check className="mt-1 size-4 text-accent" strokeWidth={2.4} aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="w-full border-t border-white/10 pt-6">
                <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-faint">When the beta ends</p>
                <p className="mt-4 text-[16px] font-light leading-relaxed text-white/80">
                  You keep every dataset, pipeline, dashboard and share link you built. We don’t ask for a card during the
                  beta, so nothing is charged unless you choose a paid plan.
                </p>
              </div>
              <PrimaryCta />
            </div>
          </div>
        </section>

        {/* 12 · FAQ — band */}
        <section id="faq" className={`band scroll-mt-4 ${sectionY}`}>
          <div className={`${container} grid gap-12 lg:grid-cols-[4fr_7fr]`}>
            <h2 data-animate className={h2}>
              <Eyebrow n="12" className="mb-6 flex">FAQ</Eyebrow>
              Questions <span className={quiet}>people ask us.</span>
            </h2>
            <div data-animate className="border-t-2 border-white">
              {FAQ.map(({ q, a }) => (
                <details key={q} className="group border-b border-white/10">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 py-6 text-[17px] font-medium text-white [&::-webkit-details-marker]:hidden">
                    {q}
                    <Plus className="size-5 shrink-0 text-accent transition-transform duration-300 group-open:rotate-45" aria-hidden />
                  </summary>
                  <p className="max-w-[60ch] pb-7 text-base font-light leading-relaxed text-white/70">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 13 · Final CTA — bookends the hero */}
        <section className="px-2 pb-2 sm:px-3 sm:pb-3">
          <div className="theme-dark dark hero-panel relative isolate mx-auto flex min-h-[560px] max-w-[1440px] flex-col items-center overflow-hidden rounded-[28px] border border-white/[0.06] px-5 pt-[clamp(72px,10vw,120px)] text-center sm:rounded-[36px]">
            <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
              <div className="ray left-[30%] w-[90px]" />
              <div className="ray left-[40%] w-[60px] [animation-delay:-3s]" />
              <div className="ray left-[48%] w-[110px] [animation-delay:-5s]" />
            </div>
            <div className="arch-wrap pointer-events-none absolute bottom-[-30%] left-1/2 -z-10 w-[min(900px,130%)] -translate-x-1/2" aria-hidden>
              <div className="arch-glow" />
              <div className="arch-ring arch-ring--outer" />
              <div className="arch-ring arch-ring--main" />
              <div className="arch-ring arch-ring--inner" />
            </div>
            <div className="hero-fade pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[30%]" aria-hidden />
            <h2 data-animate className="max-w-[16ch] text-[clamp(44px,7vw,88px)] font-semibold leading-[1] tracking-[-0.035em] text-white">
              Ask the question. <span className="font-extralight tracking-[-0.02em] text-highlight">Build what answers it.</span>
            </h2>
            <p data-animate style={delay(80)} className="mt-6 max-w-[50ch] text-[17px] font-light leading-relaxed text-white/75">
              Create a free account, upload a file or connect a database, and{" "}
              <Mark>get your first answer in minutes</Mark>. Your first pipeline can run the same day. No card needed.
            </p>
            <div data-animate className="mt-10 flex flex-wrap justify-center gap-3" style={delay(160)}>
              <PrimaryCta />
              <SecondaryCta />
            </div>
            <ul
              data-animate
              style={delay(240)}
              aria-label="How your data is handled"
              className="mt-12 grid max-w-[880px] gap-x-8 gap-y-3 pb-16 text-left text-[14px] text-white/65 sm:grid-cols-2"
            >
              {TRUST.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2.5">
                  <Icon className="mt-0.5 size-4 shrink-0 text-highlight" strokeWidth={2} aria-hidden />
                  {text}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

