import type { Metadata } from "next";

import { GovernanceScreen } from "@/features/governance/governance-screen";

export const metadata: Metadata = { title: "Governance" };

export default function GovernancePage() {
  return <GovernanceScreen />;
}
