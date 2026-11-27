import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/app/theme-toggle";
import { BackendUnavailable } from "@/components/layout/backend-unavailable";
import { Logo } from "@/components/layout/logo";
import { AuthHeading } from "@/features/auth/auth-heading";
import { OrganizationForm } from "@/features/onboarding/organization-form";
import { getSession } from "@/lib/api/server";

export const metadata: Metadata = { title: "Set up your organization", robots: { index: false } };

/** First stop after signing up: name the organization, which creates it and its first workspace. */
export default async function OnboardingPage() {
  const session = await getSession();
  if (session.status === "signed-out") redirect("/login");
  if (session.status === "signed-in") redirect("/home");
  if (session.status === "backend-unavailable") return <BackendUnavailable detail={session.detail} />;

  return (
    <main className="flex min-h-screen flex-col px-4 py-6 sm:px-8">
      <header className="flex items-center justify-between">
        <Logo />
        <ThemeToggle />
      </header>
      <div className="flex flex-1 items-center justify-center py-12">
        <div className="w-full max-w-[380px]">
          <AuthHeading
            title="Set up your organization"
            subtitle={`Welcome, ${session.name.split(" ")[0] || "there"}. Name your company and we'll create your first workspace.`}
          />
          <OrganizationForm />
        </div>
      </div>
    </main>
  );
}
