import type { Metadata } from "next";

import { DynamicTablesList } from "@/features/dynamic-tables/dynamic-tables-screens";

export const metadata: Metadata = { title: "Dynamic tables" };

export default function DynamicTablesPage() {
  return <DynamicTablesList />;
}
