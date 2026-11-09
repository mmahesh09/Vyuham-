import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import type { User } from "@/lib/api/client";

export const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export type SessionResult =
  | { status: "signed-in"; user: User }
  | { status: "signed-out" }
  /** Signed in with Better Auth, but FastAPI could not be reached or failed. */
  | { status: "backend-unavailable"; detail: string };

/**
 * Server-side: who is calling, as FastAPI sees it. FastAPI validates Better Auth's session
 * cookie and creates the workspace on first sign-in.
 *
 * A backend outage is reported separately from "signed out": treating it as signed out
 * sends a just-logged-in user straight back to /login, which looks like login is broken.
 */
export const getSession = cache(async (): Promise<SessionResult> => {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader.includes("better-auth.session_token")) return { status: "signed-out" };
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/me`, { headers: { cookie: cookieHeader }, cache: "no-store" });
  } catch {
    return { status: "backend-unavailable", detail: `Couldn't connect to the API at ${BACKEND_URL}.` };
  }
  if (res.status === 401) return { status: "signed-out" };
  if (!res.ok) return { status: "backend-unavailable", detail: `The API at ${BACKEND_URL} answered ${res.status}.` };
  return { status: "signed-in", user: (await res.json()) as User };
});

/** The signed-in user with their workspace, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  return session.status === "signed-in" ? session.user : null;
}
