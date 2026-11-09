import type { Metadata } from "next";

import { NewFromDataset } from "@/features/dashboards/new-from-dataset";

export const metadata: Metadata = { title: "New dashboard" };

export default async function NewDashboardPage({ searchParams }: { searchParams: Promise<{ dataset?: string }> }) {
  const { dataset } = await searchParams;
  return <NewFromDataset datasetId={dataset ?? null} />;
}
