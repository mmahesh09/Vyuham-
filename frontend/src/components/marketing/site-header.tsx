import Link from "next/link";

import { Logo } from "@/components/layout/logo";

/** The plain header for content pages (blog, help, status, privacy): logo, site links and the sign-up link. */
export function SiteHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-4 px-5 py-5">
        <Logo href="/" />
        <nav aria-label="Site" className="flex items-center gap-4 text-sm sm:gap-5">
          <Link href="/blog" className="text-muted hover:text-text">
            Blog
          </Link>
          <Link href="/help" className="text-muted hover:text-text">
            Help
          </Link>
          <Link href="/status" className="hidden text-muted hover:text-text sm:inline">
            Status
          </Link>
          <Link href="/signup" className="font-medium text-highlight hover:underline">
            Join the beta
          </Link>
        </nav>
      </div>
    </header>
  );
}
