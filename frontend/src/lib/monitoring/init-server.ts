// GlitchTip for the Node.js server runtime (server components, route handlers, server actions).
import * as Sentry from "@sentry/nextjs";

import { sharedOptions } from "@/lib/monitoring/options";

// A server-only DSN may point at a separate project; otherwise reuse the browser one.
Sentry.init(sharedOptions(process.env.GLITCHTIP_DSN || process.env.NEXT_PUBLIC_GLITCHTIP_DSN));
