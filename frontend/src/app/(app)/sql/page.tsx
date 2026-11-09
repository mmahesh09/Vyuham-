import type { Metadata } from "next";

import { SqlLabScreen } from "@/features/sql-lab/sql-lab-screen";

export const metadata: Metadata = { title: "SQL Lab" };

export default function SqlLabPage() {
  return <SqlLabScreen />;
}
