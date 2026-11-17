"use client";

import dynamic from "next/dynamic";

import { LazyMount } from "./lazy-mount";

/*
 * Below-the-fold demos, loaded when they scroll near. Their code (Recharts, the finance showcase) is
 * about 450 KB and starts timers on mount; loading it with the page blocked the main thread for seconds.
 * Each wrapper reserves roughly the demo's height so the page doesn't jump when it appears.
 */

const LiveDashboardImpl = dynamic(() => import("./live-charts").then((m) => m.LiveDashboard), { ssr: false });
const StoryFeedImpl = dynamic(() => import("./live-charts").then((m) => m.StoryFeed), { ssr: false });
const SyncCardImpl = dynamic(() => import("./live-charts").then((m) => m.SyncCard), { ssr: false });
const FilterDemoImpl = dynamic(() => import("./live-charts").then((m) => m.FilterDemo), { ssr: false });
const FinanceShowcaseImpl = dynamic(() => import("./finance-showcase").then((m) => m.FinanceShowcase), { ssr: false });

export function LazyLiveDashboard() {
  return (
    <LazyMount minHeight="clamp(520px, 60vw, 600px)">
      <LiveDashboardImpl />
    </LazyMount>
  );
}

export function LazyStoryFeed() {
  return (
    <LazyMount minHeight="420px">
      <StoryFeedImpl />
    </LazyMount>
  );
}

export function LazySyncCard() {
  return (
    <LazyMount minHeight="180px">
      <SyncCardImpl />
    </LazyMount>
  );
}

export function LazyFilterDemo() {
  return (
    <LazyMount minHeight="170px" className="flex flex-1 flex-col">
      <FilterDemoImpl />
    </LazyMount>
  );
}

export function LazyFinanceShowcase() {
  return (
    <LazyMount minHeight="clamp(900px, 110vw, 1400px)">
      <FinanceShowcaseImpl />
    </LazyMount>
  );
}
