import type { Metadata } from "next";

import { requireTestRoutes } from "./enabled";
import { TestButtons } from "./test-buttons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "GlitchTip test", robots: { index: false, follow: false } };

export default function GlitchTipTestPage() {
  requireTestRoutes();
  return (
    <main className="mx-auto max-w-xl space-y-4 p-10">
      <h1 className="text-2xl font-semibold">GlitchTip test errors</h1>
      <p className="text-sm opacity-70">
        Environment <code>{process.env.NEXT_PUBLIC_APP_ENV}</code>, release <code>{process.env.NEXT_PUBLIC_APP_RELEASE || "(none)"}</code>. Each button sends one
        sample error. Check the project&apos;s Issues page in GlitchTip.
      </p>
      <TestButtons />
    </main>
  );
}
