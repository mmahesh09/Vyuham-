import type { Metadata } from "next";

import { DataScreen } from "@/features/datasets/data-screen";

export const metadata: Metadata = { title: "Data" };

export default function DataPage() {
  return <DataScreen />;
}
