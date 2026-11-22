"use client";

import { AlertCircle, ArrowRight, LogIn, RefreshCw } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/features/auth/hooks";
import { ApiError } from "@/lib/api/client";

import { requestState, useMyTickets } from "./api";
import { RequestRow } from "./parts";
import { GuidedRequest } from "./request-flow";

/** Requests are tied to a workspace, so both panels need to know who is signed in. */
function useAuthState() {
  const me = useMe();
  if (me.isPending) return { kind: "loading" } as const;
  if (me.error instanceof ApiError && me.error.status === 401) return { kind: "signed-out" } as const;
  if (me.error) return { kind: "error", retry: () => me.refetch() } as const;
  return { kind: "signed-in", user: me.data } as const;
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => unknown }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-4 rounded-[18px] border border-line bg-surface p-6">
      <p className="flex items-center gap-2.5 text-[15px] text-text">
        <AlertCircle className="size-5 shrink-0 text-destructive" aria-hidden />
        {message}
      </p>
      <Button variant="outline" onClick={() => onRetry()}>
        <RefreshCw aria-hidden /> Try again
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Contact support: the guided request, once we know who's asking
// ---------------------------------------------------------------------------------------------

export function ContactSupport() {
  const auth = useAuthState();

  if (auth.kind === "loading") return <Skeleton className="h-[420px] rounded-[18px]" />;
  if (auth.kind === "error") return <LoadError message="We couldn't check whether you're signed in." onRetry={auth.retry} />;
  if (auth.kind === "signed-out") {
    return (
      <div className="flex flex-col gap-5 rounded-[18px] border border-line bg-surface p-6 sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-highlight">
          <LogIn className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[18px] font-semibold tracking-[-0.015em] text-text">Log in and we&apos;ll take it from there</h3>
          <p className="max-w-[52ch] text-[15px] leading-relaxed text-muted">
            Requests belong to your workspace, so we can look at the same dashboards and files you see. After logging in, open{" "}
            <span className="text-text">Help &amp; support</span> in the app sidebar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link href="/login" />}>
            Log in to contact us
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/signup" />}>
            Create an account
          </Button>
        </div>
        <p className="text-[13.5px] text-faint">
          Can&apos;t log in? Try{" "}
          <Link href="/forgot-password" className="text-highlight hover:underline">
            resetting your password
          </Link>{" "}
          or browse the{" "}
          <Link href="/help?topic=account-billing" className="text-highlight hover:underline">
            sign-in help
          </Link>
          .
        </p>
      </div>
    );
  }
  return <GuidedRequest pageUrl="/support-center" />;
}

// ---------------------------------------------------------------------------------------------
// Recent requests: a short strip in the hero for people who are signed in
// ---------------------------------------------------------------------------------------------

export function RecentRequests() {
  const auth = useAuthState();
  const tickets = useMyTickets({ enabled: auth.kind === "signed-in" });

  // Signed-out visitors (and any hiccup) just don't see the strip; the page works without it.
  if (auth.kind !== "signed-in" || tickets.error) return null;
  if (tickets.isPending) return <Skeleton className="h-[120px] w-full rounded-[16px]" />;

  const list = tickets.data ?? [];
  if (list.length === 0) return null;
  const active = list.filter((t) => t.status === "open" || t.status === "pending");
  const waiting = list.filter((t) => requestState(t) === "waiting").length;
  const shown = [...list].sort((a, b) => Number(requestState(b) === "waiting") - Number(requestState(a) === "waiting")).slice(0, 3);

  return (
    <section aria-labelledby="recent-requests-title" className="flex w-full flex-col gap-3 rounded-[18px] border border-line bg-surface/70 p-4 text-left sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recent-requests-title" className="text-[14.5px] font-medium text-text">
          Your requests{" "}
          <span className="font-normal text-faint">
            · {active.length} active
            {waiting > 0 && <span className="text-warning"> · {waiting} waiting on you</span>}
          </span>
        </h2>
        <Link href="/support" className="inline-flex min-h-9 items-center gap-1.5 text-[13.5px] font-medium text-highlight hover:underline">
          View all <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <ul className="flex flex-col gap-2">
        {shown.map((t) => (
          <RequestRow key={t.id} t={t} compact />
        ))}
      </ul>
    </section>
  );
}
