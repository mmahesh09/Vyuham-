// Optional same-origin relay for browser error reports, so ad blockers don't drop them.
// Enabled with GLITCHTIP_TUNNEL=true (see next.config.ts). It forwards only the event payload,
// never the visitor's cookies or headers, and only to this app's own GlitchTip DSN.
import { createSentryTunnelRoute } from "@sentry/nextjs/tunnel";

const dsn = process.env.NEXT_PUBLIC_GLITCHTIP_DSN;
const relay = createSentryTunnelRoute({ allowedDsns: dsn ? [dsn] : [] });

export async function POST(request: Request) {
  if (process.env.GLITCHTIP_TUNNEL !== "true" || !dsn) return new Response(null, { status: 404 });
  return relay.POST(request);
}
