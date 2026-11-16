import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

/**
 * Strips secrets and personal data from GlitchTip events before they leave the process.
 * Runs in the browser, Node and Edge runtimes, so no Node-only imports.
 *
 * What we keep: stack traces, error messages (emails masked), the route, the browser/OS,
 * and an opaque user id. What we drop: cookies, auth headers, request bodies, query values
 * that can carry tokens, link tokens in paths, and any field whose name looks secret.
 */

const FILTERED = "[Filtered]";

/** Object keys whose values are never sent, matched case-insensitively anywhere in the key. */
const SECRET_KEY = /pass(word)?|secret|token|auth|cookie|session|api[-_]?key|dsn|credential|signature|email|phone/i;

/** Query parameters whose values are never sent. Everything else is kept for debugging. */
const SECRET_PARAMS = new Set(["token", "code", "state", "email", "password", "key", "secret", "sig", "signature", "callbackurl"]);

/** Paths that carry a secret in a segment: shared dashboards and invites. */
const TOKEN_PATHS: [RegExp, string][] = [
  [/\/s\/[^/?#]+/g, "/s/[token]"],
  [/\/invite\/[^/?#]+/g, "/invite/[token]"],
];

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;

/** Masks emails and bearer tokens inside free text such as error messages. */
export function scrubText(text: string): string {
  return text.replace(EMAIL, "[email]").replace(BEARER, `Bearer ${FILTERED}`);
}

/** Masks token path segments and secret query values; works on absolute and relative URLs. */
export function scrubUrl(url: string): string {
  let out = url;
  for (const [pattern, replacement] of TOKEN_PATHS) out = out.replace(pattern, replacement);
  const q = out.indexOf("?");
  if (q === -1) return scrubText(out);
  const hashAt = out.indexOf("#", q);
  const query = out.slice(q + 1, hashAt === -1 ? undefined : hashAt);
  return scrubText(`${out.slice(0, q)}?${scrubQuery(query)}`);
}

/** Replaces the values of secret query parameters; keeps the rest. */
export function scrubQuery(query: string): string {
  return query
    .split("&")
    .map((pair) => {
      const [name] = pair.split("=", 1);
      return SECRET_PARAMS.has(decodeSafe(name).toLowerCase()) ? `${name}=${FILTERED}` : pair;
    })
    .join("&");
}

function decodeSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Deep-copies a value, replacing secret-looking keys and masking emails in strings. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return FILTERED;
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? FILTERED : scrubValue(v, depth + 1);
    return out;
  }
  return value;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const { url, query_string, headers } = event.request;
    // Bodies, cookies and env are never needed to debug a crash and can hold customer data.
    event.request = {
      url: url ? scrubUrl(url) : undefined,
      query_string: typeof query_string === "string" ? scrubQuery(query_string.replace(/^\?/, "")) : undefined,
      method: event.request.method,
      headers: headers?.["user-agent"] ? { "user-agent": headers["user-agent"] } : undefined,
    };
  }

  // Only an opaque id: no email, name, username or IP address.
  event.user = event.user?.id ? { id: String(event.user.id) } : undefined;

  if (event.message) event.message = scrubText(event.message);
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars; // local variables can hold anything
  }
  if (event.extra) event.extra = scrubValue(event.extra) as typeof event.extra;
  if (event.tags) event.tags = scrubValue(event.tags) as typeof event.tags;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  return event;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  const data = crumb.data ? { ...crumb.data } : undefined;
  if (data) {
    for (const key of ["url", "from", "to"]) if (typeof data[key] === "string") data[key] = scrubUrl(data[key] as string);
    // Never keep request or response bodies, even if a future SDK version starts recording them.
    delete data.body;
    delete data.request_body;
    delete data.response_body;
  }
  // Console arguments are logged objects of any shape (rows, users, API responses): keep the text only.
  if (crumb.category === "console" && data) delete data.arguments;
  return {
    ...crumb,
    message: crumb.message ? scrubText(crumb.message) : crumb.message,
    data: data ? (scrubValue(data) as Breadcrumb["data"]) : undefined,
  };
}
