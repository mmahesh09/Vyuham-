import type { Metadata } from "next";

import { AdminErrors } from "@/features/support/admin-errors";

export const metadata: Metadata = { title: "Errors" };

export default function ErrorsPage() {
  return <AdminErrors />;
}
