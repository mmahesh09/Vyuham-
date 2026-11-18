import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { NotFoundScene } from "@/components/marketing/not-found-scene";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This page doesn't exist or has moved.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="theme-dark dark flex min-h-screen flex-col overflow-x-clip bg-bg">
      <section className="relative isolate flex min-h-[max(700px,100svh)] flex-col">
        <NotFoundScene />
        <SiteNav variant="overlay" />
        <main className="flex flex-1 flex-col items-center px-5 pb-[25vh] pt-[clamp(40px,11vh,112px)] text-center">
          <div className="relative flex flex-col items-center">
            {/* Keeps the words clear of the brightest particles */}
            <div
              className="pointer-events-none absolute -inset-x-16 -inset-y-12 -z-10 bg-[radial-gradient(closest-side,rgba(7,5,4,0.78),rgba(7,5,4,0.42)_62%,transparent)]"
              aria-hidden
            />
            <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-white/70">Page not found</p>
            <h1 className="mt-3 text-[clamp(92px,13vw,148px)] font-semibold leading-[0.95] tracking-[-0.05em] text-white">404</h1>
            <p className="mt-4 max-w-[36ch] text-[clamp(17px,1.5vw,20px)] font-light leading-[1.45] text-white/80">
              This page fell out of formation. It may have moved, or the link may be wrong.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/" className="btn-primary inline-flex min-h-12 items-center gap-2 rounded-full px-7 text-[15px] font-semibold">
                Back to home
                <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
              </Link>
              <Link
                href="/support-center"
                className="btn-ghost inline-flex min-h-12 items-center rounded-full bg-black/30 px-7 text-[15px] font-medium backdrop-blur-sm"
              >
                Get support
              </Link>
            </div>
          </div>
        </main>
      </section>
      <SiteFooter />
    </div>
  );
}
