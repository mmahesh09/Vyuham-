import Link from "next/link";

import { SITE_NAME } from "@/lib/site";

const LINKS: [string, string][] = [
  ["Blog", "/blog"],
  ["Help center", "/help"],
  ["System status", "/status"],
  ["Contact support", "/support/new"],
  ["Privacy", "/privacy"],
];

/** The plain footer for content pages (blog, help, status, privacy). */
export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-4 px-5 py-8 text-[13px] sm:flex-row sm:items-center sm:justify-between">
        <p className="text-faint">© 2026 {SITE_NAME}</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          {LINKS.map(([label, href]) => (
            <Link key={href} href={href} className="text-muted hover:text-text">
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
