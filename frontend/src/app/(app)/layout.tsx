import { redirect } from "next/navigation";

import { BackendUnavailable } from "@/components/layout/backend-unavailable";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { VerifyEmailBanner } from "@/features/auth/verify-email-banner";
import { getSession } from "@/lib/api/server";
import { AppProviders } from "@/providers/app-providers";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.status === "signed-out") redirect("/login");
  if (session.status === "backend-unavailable") return <BackendUnavailable detail={session.detail} />;
  const { user } = session;

  return (
    <AppProviders user={user}>
      <div className="flex min-h-screen">
        <Sidebar workspaceName={user.workspace.name} userName={user.name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar workspaceName={user.workspace.name} userName={user.name} />
          <main className="flex-1 px-[clamp(16px,4vw,48px)] pb-20 pt-8">
            <VerifyEmailBanner />
            {children}
          </main>
        </div>
      </div>
    </AppProviders>
  );
}
