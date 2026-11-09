import { redirect } from "next/navigation";

import { BackendUnavailable } from "@/components/layout/backend-unavailable";
import { Sidebar } from "@/components/layout/sidebar";
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
      <div className="flex min-h-screen flex-wrap items-stretch">
        <Sidebar workspaceName={user.workspace.name} userName={user.name} />
        <main className="min-w-0 flex-[999_1_560px] px-[clamp(20px,5vw,72px)] pb-18 pt-10">
          <VerifyEmailBanner />
          {children}
        </main>
      </div>
    </AppProviders>
  );
}
