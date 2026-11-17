import type { Metadata } from "next";
import { Suspense } from "react";

import { NewTicket } from "@/features/support/new-ticket";

export const metadata: Metadata = { title: "New support request" };

export default function NewTicketPage() {
  return (
    <Suspense>
      <NewTicket />
    </Suspense>
  );
}
