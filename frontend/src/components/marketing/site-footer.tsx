import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { container } from "@/components/marketing/tokens";
import { SITE_NAME } from "@/lib/site";

const COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: "Product",
    links: [
      ["Try Vyuham", "/try"],
      ["About", "/about"],
      ["How it works", "/#how-it-works"],
      ["Connect a database", "/#databases"],
      ["Compare to Power BI", "/#compare"],
      ["Pricing", "/#pricing"],
      ["FAQ", "/#faq"],
      ["Blog", "/blog"],
    ],
  },
  {
    title: "Support",
    links: [
      ["Support center", "/support-center"],
      ["Help center", "/help"],
      ["Contact support", "/support/new"],
      ["System status", "/status"],
    ],
  },
  { title: "Account", links: [["Join the beta", "/signup"], ["Log in", "/login"]] },
  { title: "Legal", links: [["Privacy", "/privacy"], ["Terms", "/terms"]] },
];

/** The site footer for every marketing page. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className={`${container} grid grid-cols-2 gap-x-6 gap-y-10 py-14 text-sm lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]`}>
        <div className="col-span-2 flex flex-col items-start gap-3 lg:col-span-1">
          <Logo />
          <p className="max-w-[32ch] px-2.5 font-light text-muted">
            Dashboards and plain-English answers from your spreadsheets and databases, for teams without a data team.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title} className="flex flex-col gap-1">
            <p className="mb-2 font-semibold text-text">{col.title}</p>
            {col.links.map(([label, href]) => (
              <Link key={label} href={href} className="flex min-h-9 w-fit items-center text-muted hover:text-text">
                {label}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className={`${container} border-t border-line py-6 text-[13px] text-faint`}>© 2026 {SITE_NAME}</div>
    </footer>
  );
}
