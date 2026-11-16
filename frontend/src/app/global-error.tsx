"use client";

// Reports crashes that escape every other boundary (including the root layout) to GlitchTip.
// The page itself is Next.js's built-in one, so what visitors see is unchanged.
import * as Sentry from "@sentry/nextjs";
import NextDefaultGlobalError from "next/dist/client/components/builtin/global-error";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return <NextDefaultGlobalError error={error} />;
}
