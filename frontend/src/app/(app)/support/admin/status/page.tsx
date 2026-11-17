import type { Metadata } from "next";

import { AdminStatus } from "@/features/support/admin-status";

export const metadata: Metadata = { title: "Status & incidents" };

export default function StatusAdminPage() {
  return <AdminStatus />;
}
