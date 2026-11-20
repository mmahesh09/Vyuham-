import { ArrowRight, Check, Copy, Globe, Plus, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RSS_ALTERNATE } from "@/lib/site";
import { Hero } from "@/components/marketing/hero";
import { LazyFilterDemo, LazyLiveDashboard, LazyStoryFeed, LazySyncCard } from "@/components/marketing/lazy-demos";
import { DATABASE_LOGOS, IntegrationGrid } from "@/components/marketing/integration-grid";
import { MessySheet } from "@/components/marketing/messy-sheet";
import { ParticlesBackground } from "@/components/marketing/particles-background";
import { ColumnsShot } from "@/components/marketing/product-shots";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter } from "@/components/marketing/site-footer";
import { body, container, delay, h2, quiet, sectionY } from "@/components/marketing/tokens";
import { LogoMark } from "@/components/layout/logo";
import { Mark } from "@/components/ui/mark";

const SITE_NAME = "Vyuham";
const DESCRIPTION =
  "Turn Excel, CSV, PostgreSQL or MySQL data into a small business dashboard. Ask in plain English and get a chart with a one-line answer. Free during the beta.";

export const metadata: Metadata = {
  title: "Turn Spreadsheets Into Dashboards for Small Business",
  description: DESCRIPTION,
  alternates: { canonical: "/", types: RSS_ALTERNATE },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: "Turn your spreadsheets into dashboards you can question",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Turn your spreadsheets into dashboards you can question",
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
  { label: "File size", value: "Up to 10 MB, 1M rows" },
  { label: "Formulas needed", value: "None" },
  { label: "Pricing", value: "Free in beta, then one flat price" },
];

function PrimaryCta({ children = "Ask your first question" }: { children?: React.ReactNode }) {
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

const MOMENTS: { when: string; text: React.ReactNode }[] = [
  {
    when: "Monday, 9:02",
    text: (
      <>
        Your co-founder asks if sales are up. You open four spreadsheets, copy columns into a fifth and fight a #REF!
        error. Forty minutes later the answer is <Mark>“roughly, yes.”</Mark> Nobody is sure what “roughly” covers.
      </>
    ),
  },
  {
    when: "Three months later",
    text: (
      <>
        A client went quiet in July. You find out in October, when an invoice doesn’t go out. The signal sat in your
        data the whole time, and <Mark>nobody had time to look.</Mark>
      </>
    ),
  },
  {
    when: "Day 9 of the trial",
    text: (
      <>
        You tried Power BI. It wanted a data model, DAX formulas and a weekend of tutorials. By day 9 you were back in
        Excel, and the <Mark>spreadsheet had won by default.</Mark>
      </>
    ),
  },
];

const STEPS: { title: string; text: React.ReactNode }[] = [
  {
    title: "Bring your data",
    text: (
      <>
        Drop in an Excel or CSV file, or connect PostgreSQL or MySQL. Vyuham labels every column as a number, date,
        category or text, and <Mark>you can correct any label.</Mark>
      </>
    ),
  },
  {
    title: "Ask in plain English",
    text: (
      <>
        Type “Top 5 customers by revenue” and you get <Mark>a one-line answer and the right chart.</Mark> If Vyuham
        can’t match your words to a column, it says so and suggests questions that will work.
      </>
    ),
  },
  {
    title: "Save it and share it",
    text: (
      <>
        Pin answers to a dashboard, or start from one Vyuham builds for you. Then invite your team, export a PDF or{" "}
        <Mark>send a read-only link.</Mark>
      </>
    ),
  },
];

const OLD_WAY = [
  ["9:02", "Open Sales_FINAL_v3, Invoices and the bank export"],
  ["9:11", "Copy October into a new tab. Then September."],
  ["9:24", "Fix the #REF! in column F. Break column G."],
  ["9:35", "Build a pivot table. Wonder if refunds are in it."],
  ["9:44", "“Roughly yes, I think?”"],
];

const MESSY_FIXES = [
  { label: "Column types", text: "Numbers, dates, categories and text are labelled when the file arrives." },
  { label: "Your corrections", text: "If a customer ID gets read as a number, change it once and later charts use the fix." },
  { label: "Files that belong together", text: "SQL Lab spots when “customer” in one table looks like “company_name” in another and suggests the join." },
];

const DATABASE_FACTS = [
  { label: "Read-only sessions", text: "Every connection is opened read-only, and queries have a time limit." },
  { label: "Encrypted password", text: "Your database password is stored encrypted and never shown again." },
  { label: "SSL by default", text: "New connections require SSL unless you turn it off yourself." },
  { label: "Your choice of tables", text: "Only the tables you pick are copied into your workspace." },
];

const COMPARE = [
  { topic: "Getting started", them: "Build a data model first", us: "Start from the file you already have" },
  { topic: "Setup time", them: "Days to weeks of setup", us: "Your first chart in minutes" },
  { topic: "Who can use it", them: "Someone trained in the tool", us: "Anyone who can type a question" },
  { topic: "Who maintains it", them: "Usually an analyst", us: "Whoever owns the numbers" },
  { topic: "Calculations", them: "DAX and calculated fields", us: "Short questions in plain English" },
  { topic: "What you get", them: "Charts you have to interpret", us: "A one-line answer with the chart" },
  { topic: "Pricing", them: "Per person, per month", us: "One price for the whole company" },
];

/** `text` is the plain-text answer used for the FAQPage structured data. */
const FAQ: { q: string; a: React.ReactNode; text: string }[] = [
  {
    q: "How do I turn a spreadsheet into a dashboard?",
    text: "Upload your Excel or CSV file and choose to have a starter dashboard built from your columns. Edit it, ask more questions and save any answer to the dashboard.",
    a: (
      <>
        Upload your Excel or CSV file and choose to have <Mark>a starter dashboard built from your columns</Mark>. Edit
        it, ask more questions and save any answer to the dashboard.
      </>
    ),
  },
  {
    q: "What kinds of questions can I ask?",
    text: "Totals, averages, counts, rankings and breakdowns over time or by category. “Revenue by month”, “Top 5 products by revenue” and “How many orders in North” all work. Naming a column helps. Vyuham can show you what changed, but it can’t explain why.",
    a: (
      <>
        Totals, averages, counts, rankings and breakdowns over time or by category.{" "}
        <Mark>“Revenue by month”, “Top 5 products by revenue” and “How many orders in North”</Mark> all work. Naming a
        column helps. Vyuham can show you what changed, but it can’t explain why.
      </>
    ),
  },
  {
    q: "Does Vyuham use AI?",
    text: "Not yet. Today it matches your words to your columns using rules, then runs a real query, so every number comes from your data. If a question doesn’t match, it tells you instead of guessing.",
    a: (
      <>
        Not yet. Today it matches your words to your columns using rules, then runs a real query, so{" "}
        <Mark>every number comes from your data.</Mark> If a question doesn’t match, it tells you instead of guessing.
      </>
    ),
  },
  {
    q: "My spreadsheets are a mess. Will it still work?",
    text: "Usually, if there’s one header row and one record per row. Vyuham works out your column types, and you can correct them. Tidy labels first, because “Paid” and “PAID” count as two different values.",
    a: (
      <>
        Usually, if there’s <Mark>one header row and one record per row</Mark>. Vyuham works out your column types, and
        you can correct them. Tidy labels first, because “Paid” and “PAID” count as two different values.
      </>
    ),
  },
  {
    q: "Is this a Power BI or Tableau alternative?",
    text: "For small teams without an analyst, yes. Power BI and Tableau go much deeper and suit companies with someone to build and maintain reports. Vyuham is for the founder, manager or owner who is the data team.",
    a: (
      <>
        For small teams without an analyst, yes. Power BI and Tableau go much deeper and suit companies with someone to
        build and maintain reports. Vyuham is for the founder, manager or owner who <Mark>is the data team.</Mark>
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
    q: "Can Vyuham change anything in my database?",
    text: "Vyuham connects in read-only sessions and copies the tables you choose into your workspace for analysis. Your password is stored encrypted. We still recommend a dedicated database user that can only read those tables.",
    a: (
      <>
        Vyuham connects in <Mark>read-only sessions</Mark> and copies the tables you choose into your workspace for
        analysis. Your password is stored encrypted. We still recommend a dedicated database user that can only read
        those tables.
      </>
    ),
  },
  {
    q: "Who can see my data?",
    text: "Your team. Each company’s data is kept separately, and a dashboard is only public if you create a share link for it. You can turn a link off at any time.",
    a: (
      <>
        Your team. Each company’s data is kept separately, and a dashboard is only public if{" "}
        <Mark>you create a share link</Mark> for it. You can turn a link off at any time.
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
    q: "What happens to my dashboards after the beta?",
    text: "You keep everything you built: datasets, dashboards, saved answers and share links. Nothing is deleted when the beta ends.",
    a: (
      <>
        <Mark>You keep everything you built</Mark>: datasets, dashboards, saved answers and share links. Nothing is
        deleted when the beta ends.
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
                  You have the data. <span className={`block ${quiet}`}>You just can’t see it.</span>
                </h2>
                <p className={`${body} max-w-[46ch]`}>
                  Small businesses run on spreadsheets: sales in one file, invoices in another, the bank export in a
                  third. Simple questions about revenue, margins or cash take hours of copying and checking. Business
                  intelligence tools could help, but <Mark>they’re built for companies with a data team.</Mark>
                </p>
              </div>
              <ol className="flex flex-col">
                {MOMENTS.map((m, i) => (
                  <li key={m.when} data-animate style={delay(i * 100)} className="border-t border-white/10 py-6">
                    <p className="font-mono text-[13px] text-accent">{m.when}</p>
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

        {/* 2 · How it works — band, three steps */}
        <section id="how-it-works" className={`band relative isolate scroll-mt-4 ${sectionY}`}>
          <div className="glow glow--lilac left-[-5%] top-[20%] h-[380px] w-[520px]" />
          <div className={container}>
            <div data-animate className="mb-14 grid gap-6 lg:grid-cols-[5fr_6fr] lg:items-end">
              <h2 className={h2}>
                <Eyebrow n="02" className="mb-6 flex">How it works</Eyebrow>
                From spreadsheet to dashboard <span className={quiet}>in three steps.</span>
              </h2>
              <p className={`${body} max-w-[46ch]`}>
                Everything happens in your browser. If you can write an email, you can get{" "}
                <Mark>answers from your business data.</Mark>
              </p>
            </div>
            <ol className="grid gap-4 md:grid-cols-3">
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
          </div>
        </section>

        {/* 3 · Same question, two ways — black */}
        <section id="product" className={`relative isolate scroll-mt-4 ${sectionY}`}>
          <div className="glow glow--violet right-[0%] top-[55%] h-[460px] w-[620px]" />
          <div className={container}>
            <div data-animate className="flex flex-col gap-6">
              <Eyebrow n="03">The same question, two ways</Eyebrow>
              <p className="max-w-[22ch] text-[clamp(40px,5.6vw,76px)] font-extralight leading-[1.04] tracking-[-0.03em] text-white">
                “Are we selling more than last month?”
              </p>
              <p className={`${body} max-w-[56ch]`}>
                Your co-founder’s question, answered twice. On the left, the spreadsheet routine most small teams know
                too well. On the right, you type <Mark>“Revenue by month”</Mark> and read the result.
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
              <p className="mt-4 text-center text-[13px] text-white/40">Sample data, animated to show the layout. Your dashboards update when you replace a file or a database table syncs.</p>
            </div>
          </div>
        </section>

        {/* 4 · Messy data, handled — band, media left */}
        <section className={`band ${sectionY}`}>
          <div className={`${container} grid items-center gap-16 lg:grid-cols-[6fr_5fr]`}>
            <div data-animate className="order-2 lg:order-1">
              <ColumnsShot />
            </div>
            <div data-animate className="order-1 flex flex-col gap-6 lg:order-2" style={delay(120)}>
              <Eyebrow n="04">Your data as it is</Eyebrow>
              <h2 className={h2}>
                Bring the file you have. <span className={quiet}>Vyuham reads the columns.</span>
              </h2>
              <p className={`${body} max-w-[44ch]`}>
                Export it from your accounting tool, your CRM or the shared drive. One header row and one record per
                row is all Vyuham needs. <Mark>Your original file stays as it is.</Mark>
              </p>
              <ul className="flex max-w-[46ch] flex-col gap-4 border-t border-white/10 pt-6">
                {MESSY_FIXES.map((f) => (
                  <li key={f.label} className="grid grid-cols-[20px_1fr] gap-3 text-[16px] font-light leading-relaxed text-white/75">
                    <Check className="mt-1 size-4 text-accent" strokeWidth={2.4} aria-hidden />
                    <span>
                      <strong className="font-semibold text-white">{f.label}.</strong> {f.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* 5 · Databases — black, full-width breathing visual */}
        <section id="databases" className={`scroll-mt-4 ${sectionY}`}>
          <div className={container}>
            <div data-animate className="mb-14 grid gap-6 lg:grid-cols-[5fr_6fr] lg:items-end">
              <h2 className={`${h2} max-w-[18ch]`}>
                <Eyebrow n="05" className="mb-6 flex">Databases</Eyebrow>
                Connect your database. <span className={quiet}>Vyuham only reads.</span>
              </h2>
              <p className={`${body} max-w-[46ch]`}>
                Point Vyuham at PostgreSQL or MySQL, choose the tables you care about and set them to refresh every hour
                or every day. In SQL Lab, you can <Mark>join a synced table with an uploaded CSV.</Mark>
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
              {DATABASE_FACTS.map((f) => (
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

        {/* 6 · Dashboards that explain themselves — band, media right */}
        <section id="features" className={`band scroll-mt-4 ${sectionY}`}>
          <div className={`${container} grid items-center gap-16 lg:grid-cols-[5fr_6fr]`}>
            <div data-animate className="flex flex-col gap-6">
              <Eyebrow n="06">Dashboards</Eyebrow>
              <h2 className={h2}>
                Monday morning, <span className={quiet}>already explained.</span>
              </h2>
              <p className={`${body} max-w-[42ch]`}>
                Every chart carries its headline. Revenue up 27%. Ad spend up 36%. One client at 22% of revenue.{" "}
                <Mark>You read the sentence first and open the chart for the detail.</Mark>
              </p>
              <p className={`${body} max-w-[42ch]`}>
                Set the date filter once and the whole dashboard follows it.
              </p>
            </div>
            <div data-animate style={delay(120)}>
              <LazyStoryFeed />
            </div>
          </div>
        </section>

        {/* 7 · Day-to-day — black, asymmetric 2 + 1 */}
        <section className={sectionY}>
          <div className={container}>
            <Eyebrow n="07" className="mb-6">Day to day</Eyebrow>
            <h2 data-animate className={`${h2} mb-14 max-w-[22ch]`}>
              Keep the spreadsheet. <span className={quiet}>Lose the busywork.</span>
            </h2>
            <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
              <div data-animate className="flex min-h-[300px] flex-col gap-6 rounded-[16px] border border-white/10 bg-black/40 p-6 sm:p-8">
                <div>
                  <h3 className="text-[24px] font-semibold tracking-[-0.025em] text-white">Your database keeps changing. So does the dashboard.</h3>
                  <p className="mt-2 max-w-[48ch] text-base font-light leading-relaxed text-white/65">
                    Connected tables refresh every hour or every day. For files, upload the new export over the old one
                    and <Mark>your charts stay in place.</Mark>
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
                    Investors, clients and teammates open a read-only view of the dashboard. You decide what’s shared,
                    and you can switch a link off any time.
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

        {/* 8 · Why not Power BI — band, sharp editorial table */}
        <section id="compare" className={`band scroll-mt-4 ${sectionY}`}>
          <div className={container}>
            <div data-animate className="mb-14 grid gap-6 lg:grid-cols-[5fr_6fr] lg:items-end">
              <h2 className={h2}>
                <Eyebrow n="08" className="mb-6 flex">Compared</Eyebrow>
                “Why not just use <span className={quiet}>Power BI?”</span>
              </h2>
              <div className="flex flex-col gap-4">
                <p className={`${body} max-w-[46ch]`}>
                  You can, and if you have an analyst you probably should. Power BI goes much deeper. It also expects
                  someone to build the model and look after the reports.
                </p>
                <p className={`${body} max-w-[46ch]`}>
                  Vyuham is a <Mark>Power BI and Tableau alternative for small businesses</Mark> whose questions are about
                  revenue, customers and costs, and whose data team is one busy person.
                </p>
              </div>
            </div>
            <p className="mb-3 text-[13px] text-white/45 md:hidden">Swipe the table sideways to compare →</p>
            <div data-animate data-lenis-prevent-horizontal className="-mx-[clamp(16px,5vw,48px)] overflow-x-auto px-[clamp(16px,5vw,48px)]">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <caption className="sr-only">{SITE_NAME} compared with Power BI and Tableau</caption>
                <thead>
                  <tr className="border-b-2 border-white">
                    <th scope="col" className="w-[26%] py-4 pr-6 text-sm font-normal text-white/45"><span className="sr-only">Topic</span></th>
                    <th scope="col" className="py-4 pr-6 text-sm font-normal text-white/45">Power BI, Tableau &amp; co.</th>
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
          </div>
        </section>

        {/* 9 · Pricing — black, oversized number as the breathing moment */}
        <section id="pricing" className={`scroll-mt-4 ${sectionY}`}>
          <div className={`${container} grid items-end gap-12 md:grid-cols-[auto_1fr] md:gap-20`}>
            <p data-animate className="text-lit text-[clamp(112px,22vw,280px)] font-extralight leading-[0.8] tracking-[-0.06em]" aria-label="Zero dollars">
              $0
            </p>
            <div data-animate style={delay(120)} className="flex max-w-[44ch] flex-col items-start gap-6 pb-2">
              <Eyebrow n="09">Pricing</Eyebrow>
              <h2 className="text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.08] tracking-[-0.03em] text-white">
                Free while we’re in beta.
              </h2>
              <p className={body}>
                We’re building this with our first users, so it’s free while we do. After that: one flat monthly price
                for your whole company. <Mark>Never per seat</Mark>, so the whole team can ask questions without
                anyone counting licenses.
              </p>
              <PrimaryCta>Join the free beta</PrimaryCta>
            </div>
          </div>
        </section>

        {/* 10 · FAQ — band */}
        <section id="faq" className={`band scroll-mt-4 ${sectionY}`}>
          <div className={`${container} grid gap-12 lg:grid-cols-[4fr_7fr]`}>
            <h2 data-animate className={h2}>
              <Eyebrow n="10" className="mb-6 flex">FAQ</Eyebrow>
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

        {/* 11 · Final CTA — bookends the hero */}
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
              Close the spreadsheet. <span className="font-extralight tracking-[-0.02em] text-highlight">Ask the question.</span>
            </h2>
            <p data-animate style={delay(80)} className="mt-6 max-w-[48ch] text-[17px] font-light leading-relaxed text-white/75">
              Upload a file, ask what you want to know and <Mark>get your first answer in minutes</Mark>. Free during
              the beta, no card needed.
            </p>
            <div data-animate className="mt-10" style={delay(160)}>
              <PrimaryCta />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
