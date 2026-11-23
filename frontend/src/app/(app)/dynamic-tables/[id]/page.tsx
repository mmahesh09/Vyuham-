import type { Metadata } from "next";

import { DynamicTableScreen } from "@/features/dynamic-tables/dynamic-tables-screens";

export const metadata: Metadata = { title: "Dynamic table" };

export default async function DynamicTablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DynamicTableScreen id={id} />;
}
