import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // The browser only talks to Next.js. /api/auth/* is Better Auth (src/app/api/auth);
  // every other /api/* path falls through to FastAPI, so the session cookie stays
  // first-party and no CORS setup is needed. `fallback` runs after app routes, including
  // the dynamic /api/auth/[...all] route.
  async rewrites() {
    return { beforeFiles: [], afterFiles: [], fallback: [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }] };
  },
};

export default nextConfig;
