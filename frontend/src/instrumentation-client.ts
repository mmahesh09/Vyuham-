// GlitchTip (Sentry SDK) in the browser. Loaded by Next.js before the app becomes interactive.
// The DSN is public by design: it only allows sending events to one project.
import * as Sentry from "@sentry/nextjs";

import { sharedOptions } from "@/lib/monitoring/options";

Sentry.init({
  ...sharedOptions(process.env.NEXT_PUBLIC_GLITCHTIP_DSN),
  // No session replay, user feedback widget or other optional integrations: errors only.
});

// Lets the SDK name navigations; it records nothing unless tracing is enabled.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
