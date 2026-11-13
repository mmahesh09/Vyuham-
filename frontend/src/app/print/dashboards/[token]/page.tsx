import type { Metadata } from "next";

import { PrintDashboard } from "@/features/reports/print-dashboard";

export const metadata: Metadata = { title: "Report", robots: { index: false, follow: false } };

/**
 * The page a PDF report is printed from (backend/app/reports/pdf.py). The token is signed by the
 * backend, lasts a few minutes, and fixes which dashboard, period and filters are shown.
 */
export default async function PrintDashboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="min-h-screen bg-bg">
      <PrintDashboard token={token} />
    </div>
  );
}
