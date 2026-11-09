import type { Metadata } from "next";

import { DashboardScreen } from "@/features/dashboards/dashboard-screen";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DashboardScreen id={id} />;
}
