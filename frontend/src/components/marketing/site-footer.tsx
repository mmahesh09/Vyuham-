import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { LOGO_PIECES, LOGO_VIEW_BOX } from "@/components/layout/logo-shapes";
import { container } from "@/components/marketing/tokens";
import { SITE_NAME } from "@/lib/site";

type LinkList = [label: string, href: string][];

/** The lead column, set large and light: the four places most visitors are looking for. */
const PRODUCT: LinkList = [
  ["Try Vyuham", "/try"],
  ["How it works", "/#how-it-works"],
  ["Pricing", "/#pricing"],
  ["Compare to Power BI", "/#compare"],
];

const COLUMNS: { title: string; links: LinkList }[] = [
  {
    title: "Company",
    links: [
      ["About", "/about"],
      ["Blog", "/blog"],
      ["Connect a database", "/#databases"],
      ["FAQ", "/#faq"],
    ],
  },
  {
    title: "Support",
    links: [
      ["Support center", "/support-center"],
      ["Help center", "/help"],
      ["Contact support", "/support-center#contact"],
      ["System status", "/status"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
    ],
  },
];

const ACCOUNT: LinkList = [
  ["Start free", "/signup"],
  ["Log in", "/login"],
];

const ease = "duration-300 ease-[var(--ease-out-quart)]";
const colTitle = "mb-6 font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-faint";

/** The logo mark as one flat shape, for the oversized watermark at the foot of the panel. */
function MarkWatermark() {
  return (
    <svg
      viewBox={LOGO_VIEW_BOX}
      className="pointer-events-none absolute bottom-0 left-[clamp(16px,5vw,48px)] -z-10 w-[clamp(260px,34vw,440px)] translate-y-[38%] text-text opacity-[0.045]"
      aria-hidden
    >
      {LOGO_PIECES.map((piece) => (
        <path key={piece.key} d={piece.d} fill="currentColor" />
      ))}
    </svg>
  );
}

/** The site footer for every marketing page: a raised panel with the links. */
export function SiteFooter() {
  return (
    <footer className="mt-auto">
      <div className="px-2 pt-[clamp(48px,8vw,96px)] sm:px-3">
        <div className="relative isolate mx-auto max-w-[1440px] overflow-hidden rounded-t-[28px] border border-b-0 border-line-strong bg-bg-alt shadow-[inset_0_1px_0_rgba(255,179,122,0.08)] sm:rounded-t-[36px]">
          <MarkWatermark />

          <nav
            aria-label="Footer"
            className={`${container} grid grid-cols-2 gap-x-6 gap-y-14 pt-[clamp(64px,8vw,104px)] lg:grid-cols-[2.2fr_1fr_1.2fr_1.2fr]`}
          >
            <div className="col-span-2 lg:col-span-1">
              <p className={colTitle}>Product</p>
              <ul className="flex flex-col gap-1">
                {PRODUCT.map(([label, href]) => (
                  <li key={label}>
                    <Link
                      href={href}
                      className={`inline-flex min-h-12 items-center text-[clamp(28px,3.2vw,40px)] font-extralight tracking-[-0.025em] text-text transition-colors ${ease} hover:text-highlight`}
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {COLUMNS.map((col) => (
              <div key={col.title}>
                <p className={colTitle}>{col.title}</p>
                <ul className="flex flex-col">
                  {col.links.map(([label, href]) => (
                    <li key={label}>
                      <Link
                        href={href}
                        className={`inline-flex min-h-9 items-center text-[15px] font-light text-muted transition-colors ${ease} hover:text-text`}
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="col-span-2 lg:col-span-1">
              <p className={colTitle}>Get started</p>
              <ul className="flex flex-col gap-1">
                {ACCOUNT.map(([label, href], i) => (
                  <li key={label}>
                    <Link
                      href={href}
                      className={`group inline-flex min-h-11 items-center gap-6 text-[22px] font-light tracking-[-0.015em] transition-colors ${ease} ${i === 0 ? "text-text hover:text-highlight" : "text-muted hover:text-text"}`}
                    >
                      {label}
                      {i === 0 && (
                        <ArrowUpRight
                          className={`size-5 text-highlight transition-transform ${ease} group-hover:-translate-y-0.5 group-hover:translate-x-0.5`}
                          aria-hidden
                        />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-6 max-w-[30ch] text-[15px] font-light leading-relaxed text-faint">
                Free during the beta. No card needed.
              </p>
            </div>
          </nav>

          <div
            className={`${container} mt-[clamp(120px,16vw,220px)] flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pb-8 text-[13px] font-light text-faint`}
          >
            <p>© 2026 {SITE_NAME}</p>
            <p>Dashboards for teams without a data team</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
