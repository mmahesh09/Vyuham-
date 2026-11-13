import type { Metadata } from "next";
import { Suspense } from "react";

import { PageContainer } from "@/components/app/page-container";
import { AskBox } from "@/features/command/ask-box";
import { GettingStarted, HomeOverview } from "@/features/home/home-panels";
import { getCurrentUser } from "@/lib/api/server";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const user = await getCurrentUser();
  const firstName = user?.name.split(" ")[0] ?? "";

  return (
    <PageContainer width="narrow" className="gap-10">
      {/* The question box is Home's one loud moment; everything below stays quiet. */}
      <section className="flex flex-col gap-5 pt-2" aria-labelledby="home-title">
        <div className="flex flex-col gap-2">
          <p className="text-[15px] text-faint">Hi {firstName}</p>
          <h1 id="home-title" className="text-[clamp(30px,3.6vw,44px)] font-semibold leading-[1.08] tracking-[-0.025em] text-text">
            What do you want to know?
          </h1>
        </div>
        {/* useSearchParams (?q= from the command menu) needs a Suspense boundary. */}
        <Suspense fallback={<div className="h-[68px] rounded-2xl border border-line-strong bg-surface" />}>
          <AskBox />
        </Suspense>
      </section>
      <GettingStarted />
      <HomeOverview />
    </PageContainer>
  );
}
