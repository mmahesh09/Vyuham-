import { ArrowRight, Check, Copy, Globe, Plus, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { FinanceShowcase } from "@/components/marketing/finance-showcase";
import { Hero } from "@/components/marketing/hero";
import { FilterDemo, LiveDashboard, StoryFeed, SyncCard } from "@/components/marketing/live-charts";
import { MapSection } from "@/components/marketing/map-section";
import { MessySheet } from "@/components/marketing/messy-sheet";
import { ParticlesBackground } from "@/components/marketing/particles-background";
import { ColumnsShot } from "@/components/marketing/product-shots";
import { Reveal } from "@/components/marketing/reveal";
import { Mark } from "@/components/ui/mark";

const SITE_NAME = "Vyuham";
const DESCRIPTION =
  "Turn Excel, CSV and Google Sheets into an AI dashboard. Ask questions in plain English and get the answer plus a chart in seconds. Free during the beta.";

export const metadata: Metadata = {
  title: "AI Dashboard for Small Business",
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: "Ask your spreadsheet anything: AI dashboards for small businesses",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Ask your spreadsheet anything",
    description: DESCRIPTION,
  },
};

/* Layout + type tokens (8px grid). Outfit is wider than a grotesk, so tracking is eased a little. */
const container = "mx-auto w-full max-w-[1200px] px-[clamp(16px,5vw,48px)]";
const sectionY = "py-[clamp(96px,12vw,160px)]";
const h2 = "text-balance text-[clamp(36px,4.8vw,62px)] font-semibold leading-[1.04] tracking-[-0.035em] text-white";
const quiet = "font-extralight text-muted/80"; // the second, quieter clause: 200 against 600
const body = "text-[17px] font-light leading-[1.7] text-muted";
const delay = (ms: number) => ({ "--delay": `${ms}ms` }) as React.CSSProperties;

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
  { label: "Answer time", value: "About 4 seconds" },
  { label: "Works with", value: "CSV, Excel, Google Sheets" },
  { label: "Formulas needed", value: "None" },
  { label: "Pricing", value: "One flat price, never per seat" },
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
        You notice a client has gone quiet. Not from a report. From a missing invoice. The signal was in your data the
        whole time; <Mark>nobody had time to look.</Mark>
      </>
    ),
  },
  {
    when: "Day 9 of the free trial",
    text: (
      <>
        You tried Power BI. It wanted a data model, DAX formulas and a weekend of tutorials. The trial ran out first,
        and the <Mark>spreadsheet won by default.</Mark>
      </>
    ),
  },
];

const STEPS: { title: string; text: React.ReactNode }[] = [
  {
    title: "Upload your spreadsheet",
    text: (
      <>
        Drop in an Excel or CSV file, or connect a Google Sheet. We detect dates, money, categories and IDs
        automatically, so there is <Mark>nothing to set up.</Mark>
      </>
    ),
  },
  {
    title: "Ask in plain English",
    text: (
      <>
        Type the question the way you’d ask a colleague: “Which clients grew this quarter?” You get{" "}
        <Mark>a one-sentence answer and the right chart</Mark>, not a blank canvas.
      </>
    ),
  },
  {
    title: "Save it and share it",
    text: (
      <>
        Pin answers to a dashboard that refreshes with your data. Send it as a live link to your team, investors or
        clients, <Mark>no slide deck required.</Mark>
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
  { label: "Column types", text: "Dates, currencies, percentages and IDs are detected for you, even when formats are mixed." },
  { label: "Inconsistent labels", text: "“paid”, “Paid” and “PAID” become one value, and typos in client names are grouped." },
  { label: "Files that belong together", text: "“customer” in one sheet is matched to “company_name” in another, so you can ask across both." },
];

const COMPARE = [
  { topic: "Getting started", them: "Build a data model first", us: "Drop in the file you already have" },
  { topic: "Setup time", them: "Days to weeks of setup", us: "Your first answer in minutes" },
  { topic: "Who can use it", them: "Someone trained in the tool", us: "Anyone who can type a question" },
  { topic: "Data team required", them: "Usually, to build and maintain reports", us: "No. The AI does the analysis." },
  { topic: "Formulas", them: "DAX and calculated fields", us: "None. Plain English." },
  { topic: "What you get", them: "Charts you have to interpret", us: "The answer, then the chart" },
  { topic: "Pricing", them: "Per person, per month", us: "One price for the whole company" },
];

/** `text` is the plain-text answer used for the FAQPage structured data. */
const FAQ: { q: string; a: React.ReactNode; text: string }[] = [
  {
    q: "How do I turn a spreadsheet into a dashboard?",
    text: "Upload your Excel or CSV file, or connect a Google Sheet. We suggest four to six charts right away and build a starter dashboard you can edit. Ask more questions and save any answer to the dashboard with one click.",
    a: (
      <>
        Upload your Excel or CSV file, or connect a Google Sheet. We suggest four to six charts right away and{" "}
        <Mark>build a starter dashboard for you</Mark>. Ask more questions and save any answer to the dashboard with one
        click.
      </>
    ),
  },
  {
    q: "My spreadsheets are a mess. Will it still work?",
    text: "That’s the point. We read every column, notice that “paid”, “Paid” and “PAID” mean the same thing, and ask you when something is unclear instead of guessing. Fix it once and every later answer uses the fix.",
    a: (
      <>
        That’s the point. We read every column, notice that “paid”, “Paid” and “PAID” mean the same thing, and{" "}
        <Mark>ask you when something is unclear</Mark> instead of guessing. Fix it once and every later answer uses the
        fix.
      </>
    ),
  },
  {
    q: "Can I analyze Excel data with AI without knowing formulas?",
    text: "Yes. You ask the way you’d ask a colleague. We write the query, pick the chart and tell you what it means in a sentence. No SQL, no pivot tables, no DAX.",
    a: (
      <>
        Yes. You ask the way you’d ask a colleague. We write the query, pick the chart and{" "}
        <Mark>tell you what it means in a sentence</Mark>. No SQL, no pivot tables, no DAX.
      </>
    ),
  },
  {
    q: "Is this a Power BI or Tableau alternative?",
    text: "For small teams, yes. Power BI and Tableau are built for companies with a data team. We’re built for the founder, manager or owner who is the data team: no data model, no training, and one flat price instead of a per-seat license.",
    a: (
      <>
        For small teams, yes. Power BI and Tableau are built for companies with a data team. We’re built for the
        founder, manager or owner who <Mark>is the data team</Mark>: no data model, no training, and one flat price
        instead of a per-seat license.
      </>
    ),
  },
  {
    q: "What data can I use?",
    text: "Excel and CSV files, and Google Sheets that stay in sync automatically. Exports from tools like Stripe, QuickBooks or your CRM work too, as long as they’re a spreadsheet. Direct database and app connectors come after the beta.",
    a: (
      <>
        Excel and CSV files, and <Mark>Google Sheets that stay in sync</Mark> automatically. Exports from tools like
        Stripe, QuickBooks or your CRM work too, as long as they’re a spreadsheet. Direct database and app connectors
        come after the beta.
      </>
    ),
  },
  {
    q: "Who can see my data?",
    text: "Only your team. Each company’s data is kept separately, and a dashboard is only public if you create a share link for it. You can turn a link off at any time.",
    a: (
      <>
        Only your team. Each company’s data is kept separately, and a dashboard is only public if{" "}
        <Mark>you create a share link</Mark> for it. You can turn a link off at any time.
      </>
    ),
  },
  {
    q: "How much does it cost?",
    text: "It’s free during the beta. After that, paid plans will be one flat monthly price for your whole company, not per person, so adding a teammate never adds to the bill.",
    a: (
      <>
        It’s free during the beta. After that, paid plans will be one flat monthly price for your whole company, not
        per person, so <Mark>adding a teammate never adds to the bill.</Mark>
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
      <ParticlesBackground className="fixed inset-0 -z-10" quantity={45} color="#cea3f5" size={0.5} staticity={40} ease={70} />

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
                No installs, no data modeling and no formulas. If you can write an email, you can get{" "}
                <Mark>answers from your business data.</Mark>
              </p>
            </div>
            <ol className="grid gap-4 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li
                  key={s.title}
                  data-animate
                  style={delay(i * 100)}
                  className="flex flex-col gap-4 rounded-[16px] border border-white/10 bg-black/40 p-8"
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
                One question, asked in plain English. On the left, the spreadsheet routine most small teams know too
                well. On the right, natural-language analysis that answers in <Mark>about 4 seconds</Mark>, with
                refunds already taken out.
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
                    <li key={t} className="grid grid-cols-[3.5rem_1fr] gap-3 text-[16px] text-white/50">
                      <span className="font-mono text-[13px] leading-6 text-white/35">{t}</span>
                      <span className="leading-6">{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div data-animate style={delay(120)}>
                <div className="mb-6 flex items-baseline justify-between border-b-2 border-accent pb-4">
                  <h3 className="text-xl font-semibold text-white">With {SITE_NAME}</h3>
                  <span className="font-mono text-sm text-accent">4 sec</span>
                </div>
                <ol className="flex flex-col gap-4">
                  <li className="grid grid-cols-[3.5rem_1fr] gap-3 text-[16px] text-white">
                    <span className="font-mono text-[13px] leading-6 text-highlight">9:02</span>
                    <span className="leading-6">Type the question.</span>
                  </li>
                  <li className="grid grid-cols-[3.5rem_1fr] gap-3 text-[16px] text-white">
                    <span className="font-mono text-[13px] leading-6 text-highlight">9:02</span>
                    <span className="leading-6">
                      “Yes. <Mark>October is up 18% on September</Mark>, mostly from Halden &amp; Co and two new
                      clients. Refunds are already taken out.”
                    </span>
                  </li>
                </ol>
                <p className="mt-6 text-[15px] text-white/50">And a chart, in case you want to show someone.</p>
              </div>
            </div>

            <div data-animate className="mt-20" style={delay(100)}>
              <LiveDashboard />
              <p className="mt-4 text-center text-[13px] text-white/40">Sample data. The dashboard keeps updating as your data does.</p>
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
              <Eyebrow n="04">Messy data</Eyebrow>
              <h2 className={h2}>
                Bring the messy file. <span className={quiet}>We’ll make sense of it.</span>
              </h2>
              <p className={`${body} max-w-[44ch]`}>
                No cleaning, no data model. We note that “amount” is before tax, that only “Paid” counts as revenue,
                and that “customer” here is “company_name” in your other file. <Mark>Your file stays as it is.</Mark>
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
              <p className={`${body} max-w-[44ch]`}>
                Not sure? We ask. <Mark>Fix one word, and every answer after it is right.</Mark>
              </p>
            </div>
          </div>
        </section>

        {/* 5 · Where — black, full-width breathing visual */}
        <section className={sectionY}>
          <div className={container}>
            <div data-animate className="mb-12 grid gap-6 lg:grid-cols-[5fr_6fr] lg:items-end">
              <h2 className={`${h2} max-w-[18ch]`}>
                <Eyebrow n="05" className="mb-6 flex">Maps</Eyebrow>
                Ask “where?” <span className={quiet}>Get a map.</span>
              </h2>
              <p className={`${body} max-w-[46ch]`}>
                “Where do our best customers live?” “Which region is slowing down?” If your sheet has a country, city
                or postcode column, location questions come back as <Mark>an interactive map</Mark>, ready to hover
                and compare.
              </p>
            </div>
            <div data-animate style={delay(100)}>
              <MapSection />
            </div>
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
                Your dashboard opens with what changed, in a sentence. Revenue is up. Ad spend is too high. One client
                carries a fifth of the business. <Mark>The insight comes first, the chart second.</Mark>
              </p>
              <p className={`${body} max-w-[42ch]`}>
                Every card has “Ask a follow-up”, so you can dig into the why without building a new report.
              </p>
            </div>
            <div data-animate style={delay(120)}>
              <StoryFeed />
            </div>
          </div>
        </section>

        {/* 7 · Any spreadsheet, one dashboard — full-width showcase */}
        <section id="showcase" className={`scroll-mt-4 ${sectionY}`}>
          <div className="mx-auto w-full max-w-[1360px] px-[clamp(12px,3vw,32px)]">
            <div data-animate className="mx-auto mb-14 flex max-w-[1200px] flex-col gap-4 px-[clamp(4px,2vw,16px)] md:flex-row md:items-end md:justify-between">
              <h2 className={`${h2} max-w-[18ch]`}>
                <Eyebrow n="07" className="mb-6 flex">Showcase</Eyebrow>
                One spreadsheet in. <span className={quiet}>A whole dashboard out.</span>
              </h2>
              <p className={`${body} max-w-[40ch]`}>
                This one started as a personal-finance export. <Mark>No formulas were written</Mark> to build it. Hover
                the charts, switch the period, flip the currency.
              </p>
            </div>
            <div data-animate style={delay(100)}>
              <FinanceShowcase />
            </div>
            <p className="mt-4 text-center text-[13px] text-white/40">Sample data.</p>
          </div>
        </section>

        {/* 8 · Day-to-day — band, asymmetric 2 + 1 */}
        <section className={`band ${sectionY}`}>
          <div className={container}>
            <Eyebrow n="08" className="mb-6">Day to day</Eyebrow>
            <h2 data-animate className={`${h2} mb-14 max-w-[22ch]`}>
              Keep the spreadsheet. <span className={quiet}>Lose the busywork.</span>
            </h2>
            <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
              <div data-animate className="flex min-h-[300px] flex-col gap-6 rounded-[16px] border border-white/10 bg-black/40 p-8">
                <div>
                  <h3 className="text-[24px] font-semibold tracking-[-0.025em] text-white">Your team keeps editing the Google Sheet.</h3>
                  <p className="mt-2 max-w-[48ch] text-base font-light leading-relaxed text-white/65">
                    The dashboard follows along. It refreshes every hour, or the moment you click “Refresh now”.{" "}
                    <Mark>Nobody exports anything.</Mark>
                  </p>
                </div>
                <SyncCard />
              </div>
              <div data-animate style={delay(80)} className="flex min-h-[300px] flex-col gap-5 rounded-[16px] border border-white/10 bg-black/40 p-8">
                <div>
                  <h3 className="text-[24px] font-semibold tracking-[-0.025em] text-white">Change the date once.</h3>
                  <p className="mt-2 text-base font-light leading-relaxed text-white/65">
                    Date and category filters apply to <Mark>every chart on the page</Mark>. Try it.
                  </p>
                </div>
                <FilterDemo />
              </div>
              <div data-animate className="flex flex-col justify-between gap-8 rounded-[16px] bg-accent p-8 text-[#14051b] md:col-span-2 md:flex-row md:items-end md:p-10">
                <div>
                  <h3 className="text-[clamp(24px,2.6vw,32px)] font-semibold leading-[1.1] tracking-[-0.025em]">
                    Send the board update as a link, <span className="font-light">not a 30-slide deck.</span>
                  </h3>
                  <p className="mt-3 max-w-[56ch] text-base leading-relaxed text-[#14051b]/75">
                    Investors, clients and your team see the live numbers, and filters still work for them. You decide
                    what’s shared, and you can switch a link off any time.
                  </p>
                </div>
                <div className="flex w-full max-w-[380px] items-center gap-2 rounded-full bg-[#14051b] py-1.5 pl-4 pr-1.5 text-[13px] text-white/80">
                  <Globe className="size-4 shrink-0 text-highlight" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">yourapp.com/s/october-board-update</span>
                  <span className="flex size-8 items-center justify-center rounded-full bg-accent text-[#14051b]">
                    <Copy className="size-3.5" strokeWidth={2.2} aria-hidden />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 9 · Why not Power BI — black, sharp editorial table */}
        <section id="compare" className={`scroll-mt-4 ${sectionY}`}>
          <div className={container}>
            <div data-animate className="mb-14 grid gap-6 lg:grid-cols-[5fr_6fr] lg:items-end">
              <h2 className={h2}>
                <Eyebrow n="09" className="mb-6 flex">Compared</Eyebrow>
                “Why not just use <span className={quiet}>Power BI?”</span>
              </h2>
              <div className="flex flex-col gap-4">
                <p className={`${body} max-w-[46ch]`}>
                  You can. It’s powerful. It’s also built for companies with a data team, and priced per person. If you
                  are the data team, you need something else.
                </p>
                <p className={`${body} max-w-[46ch]`}>
                  We’re a <Mark>Power BI and Tableau alternative for small businesses</Mark>: the same answers from your
                  data, without the setup, the training or the per-seat bill.
                </p>
              </div>
            </div>
            <div data-animate data-lenis-prevent-horizontal className="overflow-x-auto">
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

        {/* 10 · Pricing — band, oversized number as the breathing moment */}
        <section id="pricing" className={`band scroll-mt-4 ${sectionY}`}>
          <div className={`${container} grid items-end gap-12 md:grid-cols-[auto_1fr] md:gap-20`}>
            <p data-animate className="text-lit text-[clamp(140px,22vw,280px)] font-extralight leading-[0.8] tracking-[-0.06em]" aria-label="Zero dollars">
              $0
            </p>
            <div data-animate style={delay(120)} className="flex max-w-[44ch] flex-col items-start gap-6 pb-2">
              <Eyebrow n="10">Pricing</Eyebrow>
              <h2 className="text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.08] tracking-[-0.03em] text-white">
                Free while we’re in beta.
              </h2>
              <p className={body}>
                We’re building this with our first users, so it’s free while we do. After that: one flat monthly price
                for your whole company. <Mark>Never per seat</Mark>, so the whole team can ask questions without
                anyone counting licenses.
              </p>
              <PrimaryCta>Claim a beta spot</PrimaryCta>
            </div>
          </div>
        </section>

        {/* 11 · FAQ — black */}
        <section id="faq" className={`scroll-mt-4 ${sectionY}`}>
          <div className={`${container} grid gap-12 lg:grid-cols-[4fr_7fr]`}>
            <h2 data-animate className={h2}>
              <Eyebrow n="11" className="mb-6 flex">FAQ</Eyebrow>
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

        {/* 12 · Final CTA — bookends the hero */}
        <section className="px-2 pb-2 sm:px-3 sm:pb-3">
          <div className="hero-panel relative isolate mx-auto flex min-h-[560px] max-w-[1440px] flex-col items-center overflow-hidden rounded-[28px] border border-white/[0.06] px-5 pt-[clamp(72px,10vw,120px)] text-center sm:rounded-[36px]">
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

      <footer>
        <div className={`${container} grid gap-10 py-14 text-sm sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]`}>
          <div className="flex flex-col items-start gap-3">
            <Logo />
            <p className="max-w-[32ch] px-2.5 font-light text-white/55">
              AI dashboards and answers from your spreadsheets, for teams too small for a data team.
            </p>
          </div>
          {[
            { title: "Product", links: [["The problem", "#problem"], ["How it works", "#how-it-works"], ["Compare to Power BI", "#compare"], ["Pricing", "#pricing"], ["FAQ", "#faq"]] },
            { title: "Account", links: [["Join the beta", "/signup"], ["Log in", "/login"]] },
            { title: "Legal", links: [["Privacy", "/privacy"], ["Terms", "#"]] },
          ].map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <p className="font-semibold text-white">{col.title}</p>
              {col.links.map(([label, href]) => (
                <Link key={label} href={href} className="w-fit text-white/55 hover:text-white">
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className={`${container} border-t border-white/[0.07] py-6 text-[13px] text-white/40`}>© 2026 {SITE_NAME}</div>
      </footer>
    </>
  );
}
