import type { Metadata } from "next";

import { AlertsScreen } from "@/features/alerts/alerts-screen";

export const metadata: Metadata = { title: "Alerts & automations" };

export default function AlertsPage() {
  return <AlertsScreen />;
}
