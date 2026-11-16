// Next.js calls register() once per server runtime. GlitchTip reporting starts here.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./lib/monitoring/init-server");
  if (process.env.NEXT_RUNTIME === "edge") await import("./lib/monitoring/init-edge");
}

// Errors thrown while rendering server components, in route handlers, server actions and middleware.
export const onRequestError = Sentry.captureRequestError;
