import type { Metadata } from "next";

import { TicketScreen } from "@/features/support/ticket-screen";

export const metadata: Metadata = { title: "Support request" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  return <TicketScreen id={(await params).id} />;
}
