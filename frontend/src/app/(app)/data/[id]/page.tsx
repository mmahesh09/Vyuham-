import type { Metadata } from "next";

import { DatasetScreen } from "@/features/datasets/dataset-screen";

export const metadata: Metadata = { title: "Dataset" };

export default async function DatasetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DatasetScreen id={id} />;
}
