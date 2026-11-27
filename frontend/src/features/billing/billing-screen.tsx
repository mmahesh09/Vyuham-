"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { InlineAlert } from "@/components/app/inline-alert";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

import { formatBytes, formatInr, planName, PLANS } from "./plans";

type Usage = { metric: string; used: number; limit: number | null; percent: number | null; resets_at: string | null };
type Billing = {
  plan: { id: string; name: string; monthly_price: number | null; annual_price: number | null; support: string };
  status: string;
  billing_available: boolean;
  enforced: boolean;
  ai_credit_scope: "org" | "workspace";
  usage: Usage[];
};

const LABELS: Record<string, string> = {
  storage_bytes: "Storage",
  ai_credits: "AI credits this month",
  pipeline_runs: "Pipeline runs today",
  datasets: "Datasets",
  dashboards: "Dashboards",
  seats: "Users",
  workspaces: "Workspaces",
};

const fmt = (metric: string, v: number) => (metric === "storage_bytes" ? formatBytes(v) : v.toLocaleString("en-IN"));
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** The organization's plan and how much of it is used. Payments aren't connected yet, so no invoices or card. */
export function BillingScreen() {
  const q = useQuery({ queryKey: ["billing"], queryFn: () => api<Billing>("/organizations/current/billing") });

  return (
    <PageContainer width="medium" className="gap-7">
      <PageHeader title="Billing & usage" description="Your organization's plan and what it has used. Limits never delete anything you've made." />
      {q.isPending ? (
        <Skeleton className="h-72 w-full rounded-xl" />
      ) : q.error ? (
        <InlineAlert>
          {q.error instanceof ApiError && q.error.status === 403 ? "Only owners and admins can see billing." : q.error.message}
        </InlineAlert>
      ) : (
        <BillingBody b={q.data} />
      )}
    </PageContainer>
  );
}

function BillingBody({ b }: { b: Billing }) {
  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[13px] text-faint">Current plan</p>
          <p className="font-display text-2xl font-semibold text-text">
            {b.plan.name}
            <span className="ml-2 align-middle text-[13px] font-normal text-muted">
              {b.plan.monthly_price === null ? "Custom pricing" : b.plan.monthly_price === 0 ? "Free" : `${formatInr(b.plan.monthly_price)} / month`}
            </span>
          </p>
          <p className="text-[13px] text-muted">
            {b.plan.support} support{b.status !== "active" ? ` · ${b.status}` : ""}
          </p>
        </div>
        <Link href="/pricing" className={buttonVariants({ variant: "outline" })}>
          Compare plans
        </Link>
      </section>

      {!b.billing_available && (
        <InlineAlert tone="info">
          Vyuham is free during the beta. Payments aren&apos;t switched on yet, so there are no invoices or payment methods here.
          {!b.enforced && " Limits are shown for reference and don't block anything yet."}
        </InlineAlert>
      )}

      <section aria-labelledby="usage" className="flex flex-col gap-3">
        <h2 id="usage" className="text-[17px] font-semibold text-text">
          Usage
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {b.usage.map((u) => (
            <UsageRow key={u.metric} u={u} planId={b.plan.id} perWorkspace={u.metric === "ai_credits" && b.ai_credit_scope === "workspace"} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="plans" className="flex flex-col gap-3">
        <h2 id="plans" className="text-[17px] font-semibold text-text">
          Plans
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {PLANS.map((p) => {
            const current = p.id === b.plan.id;
            return (
              <li key={p.id} className={cn("flex flex-col gap-2 rounded-xl border p-4", current ? "border-primary/60 bg-surface" : "border-line")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-text">{p.name}</span>
                  <span className="text-[13px] text-muted">
                    {p.monthly_price === null ? "Custom" : p.monthly_price === 0 ? "Free" : `${formatInr(p.monthly_price)}/mo`}
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed text-muted">{p.description}</p>
                <span className="mt-auto pt-1 text-[12.5px] text-faint">
                  {current ? "Your plan" : p.monthly_price === 0 ? "" : b.billing_available ? "" : "Opens soon"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function UsageRow({ u, planId, perWorkspace }: { u: Usage; planId: string; perWorkspace: boolean }) {
  const pct = u.percent ?? 0;
  const tone = pct >= 100 ? "bg-accent" : pct >= 90 ? "bg-accent/80" : pct >= 70 ? "bg-primary" : "bg-highlight/70";
  const label = LABELS[u.metric] ?? u.metric;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-medium text-text">
          {label}
          {perWorkspace && <span className="font-normal text-faint"> · this workspace</span>}
        </span>
        <span className="shrink-0 text-[13px] tabular-nums text-muted">
          {fmt(u.metric, u.used)} / {u.limit === null ? "no set cap" : fmt(u.metric, u.limit)}
        </span>
      </div>
      {u.limit !== null && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
        >
          <div className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", tone)} style={{ width: `${pct}%` }} />
        </div>
      )}
      <span className={cn("text-[12px]", pct >= 90 ? "text-text" : "text-faint")}>
        {u.limit === null
          ? "Fair use"
          : pct >= 100
            ? `Limit reached${u.resets_at ? ` · resets ${day(u.resets_at)}` : ""}. Upgrade to ${planName(nextPlan(u.metric, planId, u.limit))} for more.`
            : `${fmt(u.metric, Math.max(0, u.limit - u.used))} left${u.resets_at ? ` · resets ${day(u.resets_at)}` : ""}`}
      </span>
    </li>
  );
}

const CONFIG_KEY: Record<string, string> = { ai_credits: "ai_credits_per_month", pipeline_runs: "pipeline_runs_per_day" };

/** The first plan above `current` with a higher limit (or none) for this metric. */
function nextPlan(metric: string, current: string, limit: number): string | null {
  const key = CONFIG_KEY[metric] ?? metric;
  const above = PLANS.slice(PLANS.findIndex((p) => p.id === current) + 1);
  return above.find((p) => {
    const v = (p as Record<string, unknown>)[key];
    return v === null || (typeof v === "number" && v > limit);
  })?.id ?? null;
}
