import { execSync } from "node:child_process";

import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

/** development | staging | production. Set NEXT_PUBLIC_APP_ENV explicitly on every deployment. */
function appEnvironment() {
  if (process.env.NEXT_PUBLIC_APP_ENV) return process.env.NEXT_PUBLIC_APP_ENV;
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "staging";
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

/** The version GlitchTip groups errors by: an explicit release, else the git commit being built. */
function appRelease() {
  const explicit = process.env.NEXT_PUBLIC_APP_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (explicit) return explicit;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
  } catch {
    return undefined; // e.g. Docker builds without .git: pass NEXT_PUBLIC_APP_RELEASE as a build arg
  }
}

const release = appRelease();

const nextConfig: NextConfig = {
  // Baked into the client and server bundles so both report the same environment and release.
  env: { NEXT_PUBLIC_APP_ENV: appEnvironment(), NEXT_PUBLIC_APP_RELEASE: release ?? "" },
  // The browser only talks to Next.js. /api/auth/* is Better Auth (src/app/api/auth);
  // every other /api/* path falls through to FastAPI, so the session cookie stays
  // first-party and no CORS setup is needed. `fallback` runs after app routes, including
  // the dynamic /api/auth/[...all] route.
  async rewrites() {
    return { beforeFiles: [], afterFiles: [], fallback: [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }] };
  },
};

// Source maps are uploaded to GlitchTip only when a build-time auth token is present. The token
// never reaches the bundle (no NEXT_PUBLIC_ prefix), and maps are deleted from .next after upload
// so they are never served publicly.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default withSentryConfig(nextConfig, {
  sentryUrl: process.env.SENTRY_URL, // your GlitchTip address, e.g. https://glitchtip.example.com
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: { name: release, create: uploadSourceMaps, finalize: uploadSourceMaps },
  sourcemaps: { disable: !uploadSourceMaps, deleteSourcemapsAfterUpload: true },
  widenClientFileUpload: true,
  // Opt-in: route browser events through this app (src/app/sentry-tunnel) to get past ad blockers.
  tunnelRoute: process.env.GLITCHTIP_TUNNEL === "true" ? "/sentry-tunnel" : undefined,
  // Don't send build telemetry to sentry.io; we only talk to our own GlitchTip.
  telemetry: false,
  silent: !process.env.CI,
  // A GlitchTip outage must not block a deploy: warn and ship without symbolicated traces.
  errorHandler: (err) => console.warn(`[glitchtip] source map upload failed: ${err.message}`),
});
