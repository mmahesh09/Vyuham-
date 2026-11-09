import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { Logo } from "@/components/layout/logo";
import { PublicDashboardScreen } from "@/features/dashboards/dashboard-screen";

export const metadata: Metadata = { title: "Shared dashboard", robots: { index: false, follow: false } };

/** Public, read-only dashboard opened from a share link. No sign-in needed. */
export default async function SharedDashboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <NuqsAdapter>
      <div className="min-h-screen bg-bg">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4">
            <Logo href="/" />
            <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">Read-only</span>
          </div>
        </header>
        <main className="px-[clamp(16px,4vw,48px)] pb-10 pt-8">
          <PublicDashboardScreen token={token} />
        </main>
      </div>
    </NuqsAdapter>
  );
}
