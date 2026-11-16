// GlitchTip for the Edge runtime (middleware and edge route handlers, if any are added).
import * as Sentry from "@sentry/nextjs";

import { sharedOptions } from "@/lib/monitoring/options";

Sentry.init(sharedOptions(process.env.GLITCHTIP_DSN || process.env.NEXT_PUBLIC_GLITCHTIP_DSN));
