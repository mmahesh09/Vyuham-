import type { Metadata } from "next";

import { Logo } from "@/components/layout/logo";
import { InviteScreen } from "@/features/team/invite-screen";

export const metadata: Metadata = { title: "Join a workspace", robots: { index: false, follow: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="min-h-screen bg-bg">
      <header className="px-5 py-5">
        <Logo href="/" />
      </header>
      <InviteScreen token={token} />
    </div>
  );
}
