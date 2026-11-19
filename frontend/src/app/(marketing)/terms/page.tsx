import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { LEGAL } from "@/lib/legal";

const UPDATED = "19 November 2026";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Vyuham, including your data, acceptable use, the free beta and how accounts can end.",
  alternates: { canonical: "/terms" },
};

const SECTIONS: { title: string; body: React.ReactNode[] }[] = [
  {
    title: "Using Vyuham",
    body: [
      <>You must be at least 18 and able to accept these terms. If you use Vyuham for an organisation, you confirm that you may accept them on its behalf.</>,
      <>Keep your sign-in details safe and tell us if you think someone else has used your account. You are responsible for what happens in your workspace.</>,
    ],
  },
  {
    title: "Your data",
    body: [
      <>Files, database tables, dashboards and other content you bring to Vyuham remain yours. You give us permission to store and process them only to provide the service to you and your team.</>,
      <>You confirm that you have the right to use this data, including any personal data it contains. Our <Link href="/privacy" className="font-medium text-highlight hover:underline">Privacy Policy</Link> explains how data is handled.</>,
    ],
  },
  {
    title: "Database connections",
    body: [
      <>Connect only databases you are authorised to access. Use a dedicated read-only database user limited to the tables you want to analyse. You remain responsible for your database, its credentials and its firewall settings.</>,
    ],
  },
  {
    title: "Acceptable use",
    body: [
      <>Do not break the law, infringe others&apos; rights, upload malicious code, try to reach another workspace&apos;s data, probe or overload the service, or get around its limits and security controls.</>,
    ],
  },
  {
    title: "Answers and charts",
    body: [
      <>Vyuham calculates results from the data and columns you provide, and it can misread a question or a column. Check important figures before relying on them for financial, legal, tax or other significant decisions.</>,
    ],
  },
  {
    title: "The beta and pricing",
    body: [
      <>Vyuham is free during the beta. Features and limits may change while we build it. We will tell you before paid plans begin, and you won&apos;t be charged unless you choose a paid plan.</>,
    ],
  },
  {
    title: "Availability and liability",
    body: [
      <>The beta is provided &ldquo;as is&rdquo;, without a promise that it will be uninterrupted or error-free. Keep your own copies of important data.</>,
      <>To the extent the law allows, we are not liable for indirect or consequential losses, or for lost profits, revenue or data. Nothing in these terms limits liability that cannot be limited by law.</>,
    ],
  },
  {
    title: "Ending your use",
    body: [
      <>You can stop using Vyuham and delete your account at any time. We may suspend or close an account that breaks these terms or puts the service or other users at risk.</>,
    ],
  },
  {
    title: "Changes and governing law",
    body: [
      <>We may update these terms and will change the date above. For significant changes we will give notice by email or in the app. These terms are governed by the laws of India, and the courts of {LEGAL.courts} have jurisdiction.</>,
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[72ch] flex-1 flex-col gap-8 px-5 pb-24 pt-12">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-faint">Last updated {UPDATED}</p>
          <h1 className="font-display text-[clamp(34px,5vw,48px)] font-semibold leading-[1.05] tracking-tight">Terms of Service</h1>
          <p className="text-[15.5px] leading-[1.75] text-muted">
            These terms are an agreement between you and {LEGAL.entity} (&ldquo;Vyuham&rdquo;, &ldquo;we&rdquo;) for using the Vyuham website and app.
          </p>
        </div>

        {SECTIONS.map((section, i) => (
          <section key={section.title} className="flex flex-col gap-3">
            <h2 className="pt-2 font-display text-[24px] font-semibold leading-tight text-text">
              {i + 1}. {section.title}
            </h2>
            {section.body.map((text, j) => (
              <p key={j} className="text-[15.5px] leading-[1.75] text-muted">
                {text}
              </p>
            ))}
          </section>
        ))}

        <section className="rounded-xl border border-line bg-surface p-5 text-[15px] leading-relaxed text-muted">
          <h2 className="font-semibold text-text">Contact</h2>
          <p className="mt-2">{LEGAL.entity}</p>
          <p>{LEGAL.address}</p>
          <p>{LEGAL.supportEmail}</p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
