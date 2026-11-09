import type { Metadata } from "next";

import { Mark } from "@/components/ui/mark";
import { AuthHeading } from "@/features/auth/auth-heading";
import { ResetPasswordForm } from "@/features/auth/auth-form";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false, follow: false } };

/** Better Auth redirects here with ?token=… (valid link) or ?error=INVALID_TOKEN. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  return (
    <>
      <AuthHeading
        title="Set a new password"
        subtitle={
          <>
            Choose a password with <Mark sweepOnLoad>at least 8 characters</Mark>. You’ll be signed in to your
            workspace right after.
          </>
        }
      />
      <ResetPasswordForm token={token} initialError={error ? "This reset link is invalid or has expired. Request a new one." : undefined} />
    </>
  );
}
