import type { Metadata } from "next";

import { Mark } from "@/components/ui/mark";
import { AuthHeading } from "@/features/auth/auth-heading";
import { LoginForm } from "@/features/auth/auth-form";
import { enabledProviders } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to Vyuham to ask questions about your spreadsheets and open your AI dashboards.",
  alternates: { canonical: "/login" },
};

/** Better Auth sends social sign-in failures back here as ?error=<code>. */
const SOCIAL_ERRORS: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  account_not_linked: "This email already has an account. Log in with your password instead.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const initialError = error ? (SOCIAL_ERRORS[error] ?? "Sign-in didn't go through. Please try again.") : undefined;
  return (
    <>
      <AuthHeading
        title="Welcome back"
        subtitle={
          <>
            Log in to pick up where you left off: <Mark sweepOnLoad>your dashboards, saved answers</Mark> and shared
            links.
          </>
        }
      />
      <LoginForm providers={enabledProviders} initialError={initialError} />
    </>
  );
}
