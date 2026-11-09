import type { Metadata } from "next";

import { Mark } from "@/components/ui/mark";
import { AuthHeading } from "@/features/auth/auth-heading";
import { ForgotPasswordForm } from "@/features/auth/auth-form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading
        title="Forgot your password?"
        subtitle={
          <>
            Enter the email you signed up with and we’ll send you <Mark sweepOnLoad>a secure reset link</Mark>. Your
            data and dashboards stay exactly as they are.
          </>
        }
      />
      <ForgotPasswordForm />
    </>
  );
}
