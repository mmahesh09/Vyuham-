import type { Metadata } from "next";
import { Suspense } from "react";

import { AskBox } from "@/features/command/ask-box";
import { GettingStarted, MyTasks, RecentWork } from "@/features/home/home-panels";
import { getCurrentUser } from "@/lib/api/server";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const user = await getCurrentUser();
  const firstName = user?.name.split(" ")[0] ?? "";

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-10 pt-4">
      <section className="flex flex-col gap-5">
        <p className="text-[15px] text-faint">Hi {firstName}</p>
        <h1 className="font-display text-[clamp(34px,4.4vw,52px)] font-semibold leading-[1.05] tracking-tight">What do you want to know?</h1>
        {/* useSearchParams (?q= from the command menu) needs a Suspense boundary. */}
        <Suspense fallback={<div className="h-[72px] rounded-2xl border border-primary bg-surface" />}>
          <AskBox />
        </Suspense>
      </section>
      <GettingStarted />
      <MyTasks />
      <RecentWork />
    </div>
  );
}
