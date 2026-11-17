/**
 * Browser error reporting through the Sentry SDK to a self-hosted GlitchTip, plus the "we've seen this
 * before" lookup. Off unless NEXT_PUBLIC_SENTRY_DSN is set; the SDK is only downloaded when it's on.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

type Sentry = typeof import("@sentry/nextjs");
let loading: Promise<Sentry | null> | null = null;

/** Start the SDK once (from instrumentation-client.ts). Resolves to null when error tracking is off. */
export function loadSentry(): Promise<Sentry | null> {
  if (!DSN) return Promise.resolve(null);
  loading ??= import("@sentry/nextjs").then((S) => {
    S.init({
      dsn: DSN,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
      release: process.env.NEXT_PUBLIC_RELEASE || undefined,
      // No cookies, headers, bodies or query strings leave the server or browser; users only by opaque id.
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
      tracesSampleRate: 0,
      beforeSend(event) {
        // Keep emails out of error messages, and never send cookies.
        for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = ex.value.replace(EMAIL, "[email]");
        if (event.request) delete event.request.cookies;
        return event;
      },
    });
    return S;
  });
  return loading;
}

/** Report an error; returns the event id (the reference a ticket can carry), or undefined when off. */
export async function reportError(error: unknown): Promise<string | undefined> {
  const S = await loadSentry().catch(() => null);
  return S ? S.captureException(error) : undefined;
}

export type ErrorHelp = { slug: string; title: string; summary: string };

/** The help article staff linked to this error, if there is one. */
export async function findHelp(error: Error): Promise<ErrorHelp | null> {
  const title = `${error.name || "Error"}: ${error.message || ""}`.slice(0, 300);
  if (title.length < 3) return null;
  try {
    const res = await fetch(`/api/support/errors/help?title=${encodeURIComponent(title)}`);
    return res.ok ? ((await res.json()) as ErrorHelp | null) : null;
  } catch {
    return null;
  }
}
