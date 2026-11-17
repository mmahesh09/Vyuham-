import Link from "next/link";

import { SiteHeader } from "@/components/marketing/site-header";

/** Layout for the public site's secondary pages (About, Blog, Support): the shared menu and a short footer. */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[880px] flex-1 px-[clamp(16px,5vw,48px)] pb-24 pt-[clamp(40px,7vw,88px)]">{children}</main>
      <footer className="border-t border-white/[0.07]">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-[clamp(16px,5vw,48px)] py-6 text-[13px] text-white/45">
          <span>© 2026 Vyuham</span>
          <nav aria-label="Footer" className="flex flex-wrap gap-5">
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/help" className="hover:text-white">Support</Link>
            <Link href="/signup" className="hover:text-white">Join the beta</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export const pageTitle = "text-balance text-[clamp(36px,5vw,58px)] font-semibold leading-[1.05] tracking-[-0.035em] text-white";
export const pageLead = "mt-5 max-w-[56ch] text-[clamp(16px,1.5vw,19px)] font-light leading-relaxed text-white/75";
export const sectionTitle = "text-[22px] font-semibold tracking-[-0.02em] text-white";
export const prose = "text-[16px] font-light leading-[1.75] text-muted";
