import type { Metadata } from "next";

import { BillingScreen } from "@/features/billing/billing-screen";

export const metadata: Metadata = { title: "Billing & usage" };

export default function BillingPage() {
  return <BillingScreen />;
}
