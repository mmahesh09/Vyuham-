export type Workspace = { id: string; name: string };
export type Role = "owner" | "editor" | "viewer";
export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** What the person does; null until they save their profile. */
  job_role: string | null;
  /** Confirmed their email address (Better Auth verification). */
  email_verified: boolean;
  /** Vyuham support staff: sees the support inbox, help-article editor and status tools. */
  is_staff: boolean;
  workspace: Workspace;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    /** On a 500: the reference to quote to support (the GlitchTip event id when error tracking is on). */
    public errorRef?: string,
    /** On a 500 we've seen before: the help article that explains the fix. */
    public help?: { slug: string; title: string } | null,
    /** On a 402 plan limit or plan feature: the cheapest plan that would allow it (null = Enterprise). */
    public requiredPlan?: string | null,
  ) {
    super(message);
  }
}

/** Browser-side call to the backend through the /api proxy. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    // FormData (file uploads) sets its own multipart boundary.
    headers: init.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init.headers },
    credentials: "same-origin",
  });
  if (!res.ok) {
    let message = "Something went wrong. Please try again.";
    let errorRef: string | undefined;
    let help: ApiError["help"];
    let code: string | undefined;
    let requiredPlan: string | null | undefined;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) message = body.detail[0].msg;
      else if (body.detail && typeof body.detail.message === "string") {
        // Structured errors ({code, message, ...}), e.g. plan limits (402).
        message = body.detail.message;
        if (typeof body.detail.code === "string") code = body.detail.code;
        if ("required_plan" in body.detail) requiredPlan = body.detail.required_plan ?? null;
      }
      if (typeof body.error_ref === "string") errorRef = body.error_ref;
      if (body.help && typeof body.help.slug === "string") help = body.help;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, code, errorRef, help, requiredPlan);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
