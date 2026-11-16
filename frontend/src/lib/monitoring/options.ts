import type { BrowserOptions, ErrorEvent, EventHint } from "@sentry/nextjs";

import { ApiError } from "@/lib/api/client";
import { scrubBreadcrumb, scrubEvent } from "@/lib/monitoring/scrub";

/**
 * Settings shared by the browser, Node and Edge GlitchTip clients.
 *
 * Monitoring is off unless a DSN is configured, so local development and CI behave exactly as
 * before. Environment and release are baked in at build time by next.config.ts, so the client
 * and server report the same values.
 */

/** "development" | "staging" | "production" (or any custom name set in NEXT_PUBLIC_APP_ENV). */
export const appEnvironment = process.env.NEXT_PUBLIC_APP_ENV || "development";

/** The deployed version: git commit SHA unless NEXT_PUBLIC_APP_RELEASE overrides it. */
export const appRelease = process.env.NEXT_PUBLIC_APP_RELEASE || undefined;

function sampleRate(raw: string | undefined, fallback: number) {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/** Errors that are part of normal operation and must not become GlitchTip issues. */
function isExpected(hint: EventHint): boolean {
  const err = hint.originalException;
  // 4xx from FastAPI (validation, signed out, forbidden) is shown to the user and not a bug.
  if (err instanceof ApiError && err.status < 500) return true;
  // Next.js uses thrown errors for redirect() and notFound(); they are control flow, not crashes.
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

export function sharedOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: appEnvironment,
    release: appRelease,
    // Never let the SDK attach IP addresses, cookies, request bodies or user details on its own.
    sendDefaultPii: false,
    // Performance tracing is off unless explicitly enabled; errors are always sent.
    tracesSampleRate: sampleRate(process.env.NEXT_PUBLIC_GLITCHTIP_TRACES_SAMPLE_RATE, 0),
    sampleRate: 1,
    maxBreadcrumbs: 50,
    beforeSend(event: ErrorEvent, hint: EventHint) {
      return isExpected(hint) ? null : scrubEvent(event);
    },
    beforeBreadcrumb: scrubBreadcrumb,
  } satisfies BrowserOptions;
}
