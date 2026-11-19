import type { Metadata } from "next";

import { MetricsScreen } from "@/features/metrics/metrics-screen";

export const metadata: Metadata = { title: "Metrics" };

export default function MetricsPage() {
  return <MetricsScreen />;
}
