import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminKb } from "@/features/support/admin-kb";

export const metadata: Metadata = { title: "Help articles" };

export default function KbPage() {
  return (
    <Suspense>
      <AdminKb />
    </Suspense>
  );
}
