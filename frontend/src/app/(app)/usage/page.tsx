import type { Metadata } from "next";

import { UsageScreen } from "@/features/usage/usage-screen";

export const metadata: Metadata = { title: "Workload & cost" };

export default function UsagePage() {
  return <UsageScreen />;
}
