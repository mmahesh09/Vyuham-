"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Panel, PanelRow } from "@/components/app/panel";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounced } from "@/lib/use-debounced";

import { AdminNav } from "./admin-nav";
import { useInbox, useMetrics, type Metrics } from "./api";
import { ago, StatusBadge } from "./parts";

const FILTERS = ["active", "open", "pending", "resolved", "closed", "all"] as const;

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Panel className="flex flex-col gap-1 p-4 sm:p-4">
      <p className="text-[12px] text-faint">{label}</p>
      <p className="font-display text-[24px] font-semibold leading-none text-text">{value}</p>
      {hint && <p className="text-[12px] text-faint">{hint}</p>}
    </Panel>
  );
}

function MetricsRow({ m }: { m: Metrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Stat label="Open now" value={m.open_tickets} />
      <Stat label="New this week" value={m.tickets_this_week} />
      <Stat
        label="Median first reply"
        value={m.median_first_response_hours == null ? "–" : `${m.median_first_response_hours}h`}
        hint="last 30 days"
      />
      <Stat
        label="Answered by articles"
        value={m.deflection_rate == null ? "–" : `${Math.round(m.deflection_rate * 100)}%`}
        hint={`${m.deflections_this_week} article opens this week`}
      />
      <Stat label="Errors without an article" value={m.errors_without_article} hint={`${m.new_errors_this_week} new this week`} />
    </div>
  );
}

export function AdminInbox() {
  const [filter, setFilter] = useQueryState("status", parseAsStringLiteral(FILTERS).withDefault("active"));
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  // The box updates as the person types; the URL and the search request wait for a pause.
  const [draft, setDraft] = useState(q);
  const settled = useDebounced(draft, 300);
  useEffect(() => {
    void setQ(settled || null);
  }, [settled, setQ]);
  const { data: tickets, isLoading } = useInbox(filter, q);
  const { data: metrics } = useMetrics();

  return (
    <PageContainer>
      <PageHeader title="Support inbox" description="Every customer request, across all workspaces." />
      <AdminNav />
      {metrics && <MetricsRow m={metrics} />}

      <div className="flex flex-wrap gap-3">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search subjects or paste a ticket id" className="max-w-sm" aria-label="Search tickets" />
        <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])} aria-label="Status">
          {FILTERS.map((f) => (
            <NativeSelectOption key={f} value={f}>
              {f === "active" ? "Needs attention (open + waiting)" : f[0].toUpperCase() + f.slice(1)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {isLoading ? (
        <Skeleton className="h-60 rounded-xl" />
      ) : !tickets?.length ? (
        <EmptyState icon={<Inbox />} title="Nothing here" description="No tickets match this filter." />
      ) : (
        <Panel variant="list">
          {tickets.map((t) => (
            <PanelRow key={t.id} interactive className="p-0">
              <Link href={`/support/admin/tickets/${t.id}`} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium text-text">
                    {t.priority === "urgent" || t.priority === "high" ? <span className="mr-1.5 text-destructive">●</span> : null}
                    {t.subject}
                  </span>
                  <span className="text-[13px] text-faint">
                    {t.requester_name || "Unknown"} · {t.workspace_name} · {ago(t.updated_at)}
                    {t.error_event_id && " · has error ref"}
                  </span>
                </span>
                <StatusBadge status={t.status} staff />
              </Link>
            </PanelRow>
          ))}
        </Panel>
      )}
    </PageContainer>
  );
}
