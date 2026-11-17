import type { Metadata } from "next";

import { SupportHome } from "@/features/support/support-home";

export const metadata: Metadata = { title: "Help & support" };

export default function SupportPage() {
  return <SupportHome />;
}
