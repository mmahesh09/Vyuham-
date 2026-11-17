import { formatDistanceToNow } from "date-fns";
import type { Metadata } from "next";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { publicGet, type ComponentState, type StatusIncident, type StatusSummary } from "@/lib/public-api";
import { cn } from "@/lib/utils";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "System status",
  description: "Live status of the Vyuham API, database, background jobs and file storage, with 90 days of uptime history.",
  alternates: { canonical: "/status" },
};

const DAYS = 90;
const STATE: Record<ComponentState, { label: string; dot: string; banner: string }> = {
  operational: { label: "Operational", dot: "bg-success", banner: "All systems operational" },
  maintenance: { label: "Maintenance", dot: "bg-info", banner: "Scheduled maintenance in progress" },
  degraded: { label: "Degraded", dot: "bg-warning", banner: "Some systems are degraded" },
  major_outage: { label: "Outage", dot: "bg-destructive", banner: "We're having an outage" },
};

function barColor(pct: number | undefined) {
  if (pct === undefined) return "bg-line";
  if (pct >= 99.5) return "bg-success";
  if (pct >= 95) return "bg-warning";
  return "bg-destructive";
}

function lastDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function Incident({ inc }: { inc: StatusIncident }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-5">
      <p className="font-medium text-text">{inc.title}</p>
      <ol className="flex flex-col gap-2 border-l border-line pl-4 text-[14px]">
        {inc.updates.map((u) => (
          <li key={u.id}>
            <span className="font-medium capitalize text-text">{u.status}</span>{" "}
            <time className="text-faint" dateTime={u.created_at}>
              · {formatDistanceToNow(new Date(u.created_at), { addSuffix: true })}
            </time>
            <p className="text-muted">{u.message}</p>
          </li>
        ))}
      </ol>
    </li>
  );
}

export default async function StatusPage() {
  const s = await publicGet<StatusSummary>("/status", 60);
  const days = lastDays(DAYS);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[860px] flex-1 flex-col gap-10 px-5 pb-24 pt-14">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">System status</p>
          {s ? (
            <div
              className={cn(
                "flex items-center gap-3 rounded-[18px] border px-6 py-5",
                s.overall === "operational" ? "border-success/30 bg-success/10" : s.overall === "major_outage" ? "border-destructive/30 bg-destructive/10" : "border-warning/30 bg-warning/10",
              )}
            >
              <span className={cn("size-3 shrink-0 rounded-full", STATE[s.overall].dot)} aria-hidden />
              <h1 className="font-display text-[clamp(22px,3.5vw,30px)] font-semibold text-text">{STATE[s.overall].banner}</h1>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-[18px] border border-destructive/30 bg-destructive/10 px-6 py-5">
              <span className="size-3 shrink-0 rounded-full bg-destructive" aria-hidden />
              <h1 className="font-display text-[clamp(22px,3.5vw,30px)] font-semibold text-text">We can&apos;t reach our API right now</h1>
            </div>
          )}
          {s && (
            <p className="text-[13px] text-faint">
              Checked every minute · updated {formatDistanceToNow(new Date(s.updated_at), { addSuffix: true })}
            </p>
          )}
        </div>

        {!!s?.active_incidents.length && (
          <section className="flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-faint">Ongoing</h2>
            <ul className="flex flex-col gap-3">
              {s.active_incidents.map((i) => (
                <Incident key={i.id} inc={i} />
              ))}
            </ul>
          </section>
        )}

        {s && (
          <section className="flex flex-col divide-y divide-line rounded-[18px] border border-line bg-surface">
            {s.components.map((c) => (
              <div key={c.id} className="flex flex-col gap-3 px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-text">{c.name}</p>
                  <p className="flex items-center gap-2 text-[13.5px] text-muted">
                    <span className={cn("size-2 rounded-full", STATE[c.state].dot)} aria-hidden />
                    {STATE[c.state].label}
                  </p>
                </div>
                <div className="flex h-8 items-stretch gap-[2px]" role="img" aria-label={`${c.name}: ${c.uptime_90d ?? "no"} percent uptime over ${DAYS} days`}>
                  {days.map((d) => {
                    const pct = c.days[d];
                    return (
                      <span
                        key={d}
                        title={`${d}: ${pct === undefined ? "no data" : `${pct}% up`}`}
                        className={cn("min-w-[2px] flex-1 rounded-[2px] opacity-90 hover:opacity-100", barColor(pct))}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[12px] text-faint">
                  <span>{DAYS} days ago</span>
                  <span>{c.uptime_90d == null ? "No data yet" : `${c.uptime_90d}% uptime`}</span>
                  <span>Today</span>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-faint">Past 14 days</h2>
          {s?.recent_incidents.length ? (
            <ul className="flex flex-col gap-3">
              {s.recent_incidents.map((i) => (
                <Incident key={i.id} inc={i} />
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-muted">No incidents reported.</p>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
