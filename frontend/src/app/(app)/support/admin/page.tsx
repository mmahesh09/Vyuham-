import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminInbox } from "@/features/support/admin-inbox";

export const metadata: Metadata = { title: "Support inbox" };

export default function InboxPage() {
  return (
    <Suspense>
      <AdminInbox />
    </Suspense>
  );
}
