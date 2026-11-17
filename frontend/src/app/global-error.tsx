"use client";

import "./globals.css";

import { ErrorScreen } from "@/features/support/error-screen";

/** The root layout itself failed: render a whole document with the same error screen. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="dark">
      <body>
        <ErrorScreen error={error} reset={reset} fullPage />
      </body>
    </html>
  );
}
