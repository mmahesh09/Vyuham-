"use client";

import { BookOpen, LifeBuoy, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { findHelp, reportError, type ErrorHelp } from "@/lib/report-error";

/**
 * What people see when a page crashes: the fix if staff have written one up for this error,
 * otherwise a one-click support request that carries the error reference.
 */
export function ErrorScreen({ error, reset, fullPage }: { error: Error & { digest?: string }; reset: () => void; fullPage?: boolean }) {
  const [eventId, setEventId] = useState<string | undefined>();
  const [help, setHelp] = useState<ErrorHelp | null>(null);

  useEffect(() => {
    let live = true;
    reportError(error).then((id) => live && setEventId(id));
    findHelp(error).then((h) => live && setHelp(h));
    return () => {
      live = false;
    };
  }, [error]);

  const ref = eventId ?? error.digest;
  const from = typeof window !== "undefined" ? window.location.pathname : "";
  const ticketHref = `/support/new?${new URLSearchParams({ ...(eventId && { error: eventId }), ...(from && { from }) })}`;

  return (
    <div className={fullPage ? "flex min-h-screen items-center justify-center bg-bg px-5" : "mx-auto flex max-w-[640px] flex-col py-16"}>
      <div className="flex w-full max-w-[640px] flex-col gap-5 rounded-[18px] border border-line bg-surface p-7">
        <h1 className="font-display text-[26px] font-semibold text-text">Something went wrong</h1>
        <p className="text-[15px] leading-relaxed text-muted">
          This page hit an error. {eventId ? "We've been notified." : "Trying again usually helps."}
        </p>

        {help && (
          <Link href={`/help/${help.slug}`} className="flex flex-col gap-1 rounded-xl border border-highlight/30 bg-highlight/5 p-4 hover:border-highlight/60">
            <span className="flex items-center gap-2 text-[13px] font-medium text-highlight">
              <BookOpen className="size-4" aria-hidden /> We&apos;ve seen this before
            </span>
            <span className="font-medium text-text">{help.title}</span>
            {help.summary && <span className="text-[14px] text-muted">{help.summary}</span>}
          </Link>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={reset} className="btn-primary inline-flex min-h-10 items-center gap-2 rounded-full px-5 text-[14px] font-semibold">
            <RotateCcw className="size-4" aria-hidden /> Try again
          </button>
          <a href={ticketHref} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line-strong px-5 text-[14px] text-text hover:bg-surface-2">
            <LifeBuoy className="size-4" aria-hidden /> Contact support
          </a>
        </div>
        {ref && (
          <p className="text-[12px] text-faint">
            Reference: <code className="font-mono">{ref}</code>
          </p>
        )}
      </div>
    </div>
  );
}
