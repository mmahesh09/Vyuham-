import type { Metadata } from "next";

import { AdminTicket } from "@/features/support/admin-ticket";

export const metadata: Metadata = { title: "Ticket" };

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  return <AdminTicket id={(await params).id} />;
}
