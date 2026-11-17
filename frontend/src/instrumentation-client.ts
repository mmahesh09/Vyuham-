/**
 * Runs in the browser before the app starts. Error tracking (Sentry SDK -> self-hosted GlitchTip)
 * starts here when NEXT_PUBLIC_SENTRY_DSN is set; otherwise nothing is loaded.
 */
import { loadSentry } from "@/lib/report-error";

void loadSentry();

/** Lets Sentry name client-side navigations; a no-op until (and unless) the SDK has loaded. */
export function onRouterTransitionStart(href: string, navigationType: string) {
  void loadSentry().then((S) => S?.captureRouterTransitionStart(href, navigationType));
}
