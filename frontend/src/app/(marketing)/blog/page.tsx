import type { Metadata } from "next";
import Link from "next/link";

import { PageShell, pageLead, pageTitle } from "@/components/marketing/page-shell";

export const metadata: Metadata = {
  title: "Blog",
  description: "Product updates and guides from the Vyuham team.",
  alternates: { canonical: "/blog" },
};

export default function BlogPage() {
  return (
    <PageShell>
      <p className="eyebrow">Blog</p>
      <h1 className={`${pageTitle} mt-6`}>Product updates and guides.</h1>
      <p className={pageLead}>How to get answers from your spreadsheets, what&apos;s new in Vyuham, and what we&apos;re learning along the way.</p>

      <section aria-label="Posts" className="mt-14 rounded-[20px] border border-white/10 bg-white/[0.03] p-8 text-center">
        <p className="text-[17px] font-medium text-white">No posts yet</p>
        <p className="mt-2 text-[15px] font-light text-muted">The first articles are on their way. In the meantime, see how Vyuham works.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/#how-it-works" className="btn-ghost inline-flex min-h-11 items-center rounded-full px-5 text-[14px] font-semibold">How it works</Link>
          <Link href="/signup" className="btn-primary inline-flex min-h-11 items-center rounded-full px-5 text-[14px] font-semibold">Try Vyuham</Link>
        </div>
      </section>
    </PageShell>
  );
}
