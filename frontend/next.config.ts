import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // The browser only talks to Next.js. /api/auth/* is Better Auth (src/app/api/auth);
  // every other /api/* path falls through to FastAPI, so the session cookie stays
  // first-party and no CORS setup is needed. `fallback` runs after app routes, including
  // the dynamic /api/auth/[...all] route.
  //
  // /decks is the open-slide deck app (my-deck/, built into public/decks). Its files are served
  // as-is; any other /decks path is one of its client-side routes, so it gets its index.html.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/decks", destination: "/decks/index.html" }],
      afterFiles: [],
      fallback: [
        { source: "/api/:path*", destination: `${BACKEND_URL}/:path*` },
        { source: "/decks/:path*", destination: "/decks/index.html" },
      ],
    };
  },
};

export default nextConfig;
