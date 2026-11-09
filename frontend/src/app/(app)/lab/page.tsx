import type { Metadata } from "next";

import { LabScreen } from "@/features/dashboards/lab-screen";

export const metadata: Metadata = { title: "Dashboard Lab" };

export default function LabPage() {
  return <LabScreen />;
}
