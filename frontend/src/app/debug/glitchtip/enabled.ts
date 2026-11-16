import { notFound } from "next/navigation";

/** The GlitchTip test routes exist only when explicitly switched on, and never in production. */
export function requireTestRoutes() {
  if (process.env.GLITCHTIP_TEST_PAGE !== "true" || process.env.NEXT_PUBLIC_APP_ENV === "production") notFound();
}
