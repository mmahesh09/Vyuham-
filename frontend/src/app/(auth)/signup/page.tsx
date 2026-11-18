import type { Metadata } from "next";

import { Mark } from "@/components/ui/mark";
import { AuthHeading } from "@/features/auth/auth-heading";
import { SignupForm } from "@/features/auth/auth-form";
import { enabledProviders } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Create your free account",
  description:
    "Sign up free and turn Excel, CSV, PostgreSQL or MySQL data into a dashboard. Ask in plain English and get answers with charts. No card needed.",
  alternates: { canonical: "/signup" },
};

export default function SignupPage() {
  return (
    <>
      <AuthHeading
        title="Create your free account"
        subtitle={
          <>
            Turn your spreadsheets into <Mark sweepOnLoad>a dashboard in minutes</Mark>. Free during the beta, no
            card needed.
          </>
        }
      />
      <SignupForm providers={enabledProviders} />
    </>
  );
}
