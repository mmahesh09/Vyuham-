import type { Metadata } from "next";

import { Mark } from "@/components/ui/mark";
import { AuthHeading } from "@/features/auth/auth-heading";
import { SignupForm } from "@/features/auth/auth-form";
import { enabledProviders } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Create your free account",
  description:
    "Sign up free and turn your Excel, CSV or Google Sheets into an AI dashboard. Ask questions in plain English and get answers with charts. No card needed.",
  alternates: { canonical: "/signup" },
};

export default function SignupPage() {
  return (
    <>
      <AuthHeading
        title="Create your free account"
        subtitle={
          <>
            Turn your spreadsheets into <Mark sweepOnLoad>an AI dashboard in minutes</Mark>. Free during the beta, no
            card needed.
          </>
        }
      />
      <SignupForm providers={enabledProviders} />
    </>
  );
}
