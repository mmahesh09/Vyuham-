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
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) message = body.detail[0].msg;
      if (typeof body.error_ref === "string") errorRef = body.error_ref;
      if (body.help && typeof body.help.slug === "string") help = body.help;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, undefined, errorRef, help);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
