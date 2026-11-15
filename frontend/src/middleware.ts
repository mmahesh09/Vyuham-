/**
 * Security headers on every page, set with Nosecone (https://docs.arcjet.com/nosecone).
 *
 * The Content-Security-Policy is deliberately small and enforced: it stops the app being framed by other
 * sites (clickjacking), injected <base> tags, plugins, and forms posting elsewhere. It has no script-src:
 * a nonce-based script policy needs every page rendered per request, and the marketing pages are static.
 * Add script-src (with `nonce()` from @nosecone/next) when that trade-off is worth it.
 *
 * Cross-Origin-Embedder-Policy is off: "require-corp" would block images and fonts from other origins.
 * Referrer-Policy is no-referrer, so share links (/s/<token>) and invite links never leak to other sites.
 */
import { createMiddleware, defaults } from "@nosecone/next";

export const middleware = createMiddleware({
  ...defaults,
  contentSecurityPolicy: {
    directives: {
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // OAuth sign-in redirects rather than using a popup, but keep popups working for any provider that does.
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  crossOriginResourcePolicy: { policy: "same-site" },
});

export const config = {
  // Pages only: static assets and the API proxy don't need these headers.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
