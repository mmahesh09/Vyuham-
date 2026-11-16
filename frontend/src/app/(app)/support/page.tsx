import type { Metadata } from "next";

import { SupportScreen } from "@/features/support/support-screen";

export const metadata: Metadata = { title: "Help & Support" };

export default function SupportPage() {
  return <SupportScreen />;
}
