import { ArrowRight } from "lucide-react";
import Link from "next/link";

import type { ComponentState, StatusSummary } from "@/lib/public-api";
import { cn } from "@/lib/utils";

const OVERALL_LABEL: Record<ComponentState, string> = {
  operational: "All systems operational",
  maintenance: "Scheduled maintenance in progress",
  degraded: "Some systems are degraded",
  major_outage: "We're having an outage",
};
const STATE_DOT: Record<ComponentState, string> = {
  operational: "bg-success",
  maintenance: "bg-info",
  degraded: "bg-warning",
  major_outage: "bg-destructive",
};

/**
 * One line of live status for the support center, linking to the full status page. Shows nothing as
 * live that the backend didn't report: no data means "status unavailable", not "all good".
 */
export function StatusPill({ status, className }: { status: StatusSummary | null; className?: string }) {
  const incident = status?.active_incidents[0];
  const label = !status ? "Status unavailable right now" : incident ? incident.title : OVERALL_LABEL[status.overall];
  const healthy = status?.overall === "operational" && !incident;
  return (
    <Link
      href="/status"
      className={cn(
        "group inline-flex min-h-10 max-w-full items-center gap-2.5 rounded-full border px-4 text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight",
        !status || healthy ? "border-white/10 bg-white/[0.03] text-white/75 hover:border-white/25" : "border-warning/40 bg-warning/[0.08] text-white hover:border-warning/70",
        className,
      )}
    >
      <span className="relative flex size-2.5 shrink-0" aria-hidden>
        {healthy && <span className="absolute inset-0 animate-ping rounded-full bg-success/60 motion-reduce:hidden" />}
        <span className={cn("relative size-2.5 rounded-full", status ? STATE_DOT[incident ? "degraded" : status.overall] : "bg-white/30")} />
      </span>
      <span className="truncate">{label}</span>
      <span className="sr-only">. View the status page.</span>
      <ArrowRight className="size-3.5 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}
