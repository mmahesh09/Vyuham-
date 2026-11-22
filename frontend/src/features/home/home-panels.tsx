"use client";

import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellRing,
  CalendarClock,
  CalendarOff,
  Check,
  ChevronRight,
  FileSpreadsheet,
  LayoutDashboard,
  ListTodo,
  Minus,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";

import { Panel } from "@/components/app/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlerts, useUnreadCount } from "@/features/alerts/api";
import { useMe } from "@/features/auth/hooks";
import { formatNumber } from "@/features/charts/build-option";
import { privateSource, type ChartRecord, type ChartView, type DashboardSummary } from "@/features/dashboards/api";
import { useDashboardMeta, useDashboards } from "@/features/dashboards/hooks";
import { kpiValue } from "@/features/dashboards/kpi-grid";
import { useDatasets } from "@/features/datasets/api";
import { useActivity, useMembers, type Activity } from "@/features/profile/api";
import { STATUS_LABEL, useTasks } from "@/features/team/api";
import { cn } from "@/lib/utils";

/**
 * First-run checklist: add data → build a dashboard → invite a teammate (a real sequence, so the
 * steps are numbered). With one step left it shrinks to a single row; hidden once all are done.
 */
export function GettingStarted() {
  const { data: datasets } = useDatasets();
  const { data: dashboards } = useDashboards();
  const { data: members } = useMembers();
  const { data: me } = useMe();
  if (!datasets || !dashboards || !members) return null;

  const steps = [
    { done: datasets.length > 0, title: "Add your data", hint: "Upload a file or connect a database", href: "/data", icon: FileSpreadsheet },
    { done: dashboards.length > 0, title: "Build a dashboard", hint: "We pick the first charts for you", href: "/dashboards", icon: LayoutDashboard },
    { done: members.length > 1, title: "Invite your team", hint: "Share numbers, assign data tasks", href: "/team", icon: Users, ownerOnly: true },
  ].filter((s) => !s.ownerOnly || me?.role === "owner");
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  const progress = (
    <div className="flex items-center gap-3" aria-label={`${doneCount} of ${steps.length} steps done`}>
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line" aria-hidden>
        <span className="block h-full rounded-full bg-highlight" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </span>
      <span className="text-[13px] text-faint">
        {doneCount} of {steps.length} done
      </span>
    </div>
  );

  // One step left: a slim row, not a whole panel.
  if (steps.length - doneCount === 1) {
    const next = steps.find((s) => !s.done)!;
    return (
      <Link
        href={next.href}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-5 py-3.5 transition-colors hover:border-line-strong"
      >
        <next.icon className="size-4 shrink-0 text-highlight" aria-hidden />
        <span className="min-w-0 flex-[1_1_240px] text-[14px]">
          <span className="font-semibold text-text">Last step: {next.title.toLowerCase()}.</span> <span className="text-muted">{next.hint}.</span>
        </span>
        {progress}
        <ChevronRight className="size-4 text-faint" aria-hidden />
      </Link>
    );
  }

  return (
    <Panel aria-labelledby="start-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="start-heading" className="type-section">
          Get set up
        </h2>
        {progress}
      </div>
      <ol className="grid gap-2.5 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link
              href={s.href}
              className="flex h-full items-start gap-3 rounded-lg border border-line p-3.5 transition-colors hover:border-line-strong hover:bg-surface-2/60"
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                  s.done ? "bg-success text-bg" : "bg-line text-highlight",
                )}
                aria-hidden
              >
                {s.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className={cn("text-[14px] font-semibold", s.done ? "text-muted line-through decoration-faint" : "text-text")}>{s.title}</span>
                <span className="text-[13px] text-muted">{s.done ? "Done" : s.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

const today = () => format(new Date(), "yyyy-MM-dd");
const noop = () => () => {};

/** Today's date in the viewer's own time zone (rendered on the client so the server's zone can't leak in). */
export function TodayLabel() {
  const label = useSyncExternalStore(noop, () => format(new Date(), "EEEE, d MMMM"), () => "");
  return label ? <span> · {label}</span> : null;
}

/** My open tasks, soonest due first. */
function useMyOpenTasks() {
  const { data: me } = useMe();
  const { data: tasks } = useTasks();
  return (tasks ?? [])
    .filter((t) => t.assignee_id === me?.id && t.status !== "done")
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
}

/* ------------------------------------------------------------------ attention */

type Attention = { key: string; href: string; icon: typeof Bell; count: number; label: string; hint: string; urgent: boolean };

/** Things waiting on me: alerts that fired, tasks due, unread notifications. Hidden when there's nothing. */
export function AttentionStrip() {
  const { data: alerts } = useAlerts();
  const { data: unread } = useUnreadCount();
  const mine = useMyOpenTasks();
  const now = today();

  const firing = (alerts ?? []).filter((a) => a.enabled && a.state !== "ok");
  const broken = firing.filter((a) => a.state === "error").length;
  const due = mine.filter((t) => t.due_date && t.due_date <= now);
  const overdue = due.filter((t) => t.due_date! < now).length;
  const unreadCount = unread?.count ?? 0;

  const items: Attention[] = [];
  if (firing.length)
    items.push({
      key: "alerts",
      href: "/alerts",
      icon: BellRing,
      count: firing.length,
      label: firing.length === 1 ? "alert needs a look" : "alerts need a look",
      hint: broken ? `${broken} couldn't be checked` : firing.length === 1 ? firing[0].name : "Triggered on their last check",
      urgent: true,
    });
  if (due.length)
    items.push({
      key: "tasks",
      href: "/team",
      icon: CalendarClock,
      count: due.length,
      label: due.length === 1 ? "task due" : "tasks due",
      hint: overdue ? `${overdue} overdue` : "Due today",
      urgent: overdue > 0,
    });
  if (unreadCount)
    items.push({
      key: "unread",
      href: "/alerts",
      icon: Bell,
      count: unreadCount,
      label: unreadCount === 1 ? "unread notification" : "unread notifications",
      hint: "Alerts, digests and team updates",
      urgent: false,
    });
  if (!items.length) return null;

  return (
    <section aria-labelledby="attention-heading" className="flex flex-col gap-3">
      <h2 id="attention-heading" className="type-section">
        Needs your attention
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <li key={it.key}>
            <Link
              href={it.href}
              className={cn(
                "group flex h-full items-center gap-3.5 rounded-[14px] border bg-surface p-4 transition-colors",
                it.urgent ? "border-accent/35 hover:border-accent/60" : "border-line hover:border-line-strong",
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl",
                  it.urgent ? "bg-accent/10 text-accent" : "bg-primary/10 text-highlight",
                )}
              >
                <it.icon className="size-[18px]" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[14.5px] text-text">
                  <span className="font-semibold">{it.count}</span> {it.label}
                </span>
                <span className="truncate text-[12.5px] text-faint">{it.hint}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ key numbers */

const ALL_TIME = { from: null, to: null, f: {} };

function GlanceTile({ chart, view }: { chart: ChartRecord; view?: ChartView }) {
  const { raw, change, up, down } = kpiValue(chart, view);
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <li
      className="flex min-w-0 flex-col gap-1.5 rounded-[14px] border border-line bg-surface px-4 py-3.5"
      style={chart.spec.color ? { boxShadow: `inset 0 2px 0 ${chart.spec.color}` } : undefined}
    >
      <span className="truncate text-[13px] text-muted" title={chart.spec.title}>
        {chart.spec.title}
      </span>
      {!view ? (
        <Skeleton className="h-8 w-24" />
      ) : view.error ? (
        <span className="text-[13px] text-faint">Couldn&apos;t calculate</span>
      ) : (
        <span className="type-kpi truncate text-text">{formatNumber(raw)}</span>
      )}
      {change !== null ? (
        <span className={cn("flex items-center gap-1 text-[12.5px] font-semibold", up ? "text-highlight" : down ? "text-accent" : "text-faint")}>
          <Icon className="size-3.5" strokeWidth={2.6} aria-hidden />
          <span className="sr-only">{up ? "Up" : down ? "Down" : "Flat"}</span>
          {change >= 0 ? "+" : ""}
          {change.toFixed(1)}%
        </span>
      ) : (
        <span className="text-[12px] text-faint">All time</span>
      )}
    </li>
  );
}

function Glance({ dashboard }: { dashboard: DashboardSummary }) {
  const source = useMemo(() => privateSource(dashboard.id), [dashboard.id]);
  const meta = useDashboardMeta(source);
  const charts = meta.data?.charts ?? [];
  const chartIds = charts.map((c) => c.id).join(",");
  // Same cache entry as the dashboard page with no filters, so opening it afterwards is instant.
  const view = useQuery({
    queryKey: [...source.key, "view", ALL_TIME, chartIds],
    queryFn: () => source.view(ALL_TIME),
    enabled: !!meta.data,
    staleTime: 5 * 60_000,
  });
  const kpis = charts
    .filter((c) => c.kind === "kpi")
    .sort((a, b) => a.position - b.position)
    .slice(0, 4);
  const views = new Map((view.data?.charts ?? []).map((c) => [c.id, c]));
  if (meta.isError || view.isError || (meta.data && !kpis.length)) return null;

  return (
    <section aria-labelledby="glance-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="glance-heading" className="type-section min-w-0">
          At a glance <span className="font-normal text-faint">· {dashboard.name}</span>
        </h2>
        <Link href={`/dashboards/${dashboard.id}`} className="flex items-center gap-1 text-[13px] text-highlight hover:underline">
          Open dashboard <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy={!view.data}>
        {meta.data
          ? kpis.map((c) => <GlanceTile key={c.id} chart={c} view={views.get(c.id)} />)
          : [0, 1, 2, 3].map((i) => (
              <li key={i}>
                <Skeleton className="h-[104px] rounded-[14px]" />
              </li>
            ))}
      </ul>
    </section>
  );
}

/** Key numbers from the most recently updated dashboard that has any. */
export function AtAGlance() {
  const { data: dashboards } = useDashboards();
  const pick = dashboards?.find((d) => d.kpi_count > 0);
  return pick ? <Glance dashboard={pick} /> : null;
}

/* ------------------------------------------------------------------ recent work */

type Row = { id: string; name: string; meta: string; href: string; badge?: string };

function Section({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-section">{title}</h2>
        <Link href={href} className="flex items-center gap-1 text-[13px] text-highlight hover:underline">
          {linkLabel} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {children}
    </section>
  );
}

const listBox = "flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface";

function RowList({ items, icon: Icon, empty }: { items: Row[]; icon: typeof LayoutDashboard; empty: React.ReactNode }) {
  if (!items.length) return <p className="rounded-[14px] border border-dashed border-line-strong px-4 py-5 text-sm text-faint">{empty}</p>;
  return (
    <ul className={listBox}>
      {items.map((it) => (
        <li key={it.id}>
          <Link href={it.href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/70">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-highlight">
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2">
                <span className="truncate text-[14.5px] font-medium text-text">{it.name}</span>
                {it.badge && <span className="shrink-0 rounded-full border border-line px-2 text-[11px] text-faint">{it.badge}</span>}
              </span>
              <span className="truncate text-[12.5px] text-faint">{it.meta}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-line-strong transition-transform group-hover:translate-x-0.5 group-hover:text-muted" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

const ACTIVITY_ICON: Record<Activity["kind"], typeof Bell> = {
  dataset: FileSpreadsheet,
  member: UserPlus,
  profile: UserRound,
  leave: CalendarOff,
  task: ListTodo,
};

function TeamActivity() {
  const { data } = useActivity();
  const items = (data ?? []).slice(0, 6);
  if (!items.length) return null;
  return (
    <Section title="Team activity" href="/team" linkLabel="Team">
      <ol className={listBox}>
        {items.map((a) => {
          const Icon = ACTIVITY_ICON[a.kind] ?? Users;
          return (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14px] leading-snug text-muted">
                  {a.actor ? (
                    <>
                      <span className="font-medium text-text">{a.actor}</span> {a.title.charAt(0).toLowerCase() + a.title.slice(1)}
                    </>
                  ) : (
                    a.title
                  )}
                </span>
                <span className="truncate text-[12.5px] text-faint">
                  {a.detail && `${a.detail} · `}
                  <time dateTime={a.at}>{formatDistanceToNow(new Date(a.at), { addSuffix: true })}</time>
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function YourTasks() {
  const mine = useMyOpenTasks().slice(0, 5);
  if (!mine.length) return null;
  const now = today();
  return (
    <Section title="Your tasks" href="/team" linkLabel="Open board">
      <ul className={listBox}>
        {mine.map((t) => {
          const overdue = !!t.due_date && t.due_date < now;
          return (
            <li key={t.id} className="flex items-start gap-3 px-4 py-3">
              <ListTodo className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[14.5px] text-text">{t.title}</span>
                <span className="text-[12.5px] text-faint">
                  {STATUS_LABEL[t.status]}
                  {t.due_date && (
                    <>
                      {" · "}
                      <span className={overdue ? "font-semibold text-accent" : undefined}>
                        {overdue ? "overdue, " : ""}due {format(parseISO(t.due_date), "MMM d")}
                      </span>
                    </>
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/**
 * Recent dashboards and data on the left; my tasks and what the team has been doing on the right.
 * Hidden until the workspace has something in it (the setup checklist covers that moment).
 */
export function HomeOverview() {
  const { data: dashboards } = useDashboards();
  const { data: datasets } = useDatasets();
  if (!dashboards?.length && !datasets?.length) return null;

  const recentDashboards: Row[] = (dashboards ?? []).slice(0, 4).map((d) => ({
    id: d.id,
    name: d.name,
    href: `/dashboards/${d.id}`,
    badge: d.shared ? "Shared" : undefined,
    meta: `${d.kpi_count + d.chart_count} charts · updated ${formatDistanceToNow(new Date(d.updated_at), { addSuffix: true })}`,
  }));
  const recentData: Row[] = (datasets ?? []).slice(0, 4).map((d) => ({
    id: d.id,
    name: d.name,
    href: `/data/${d.id}`,
    meta: `${d.row_count.toLocaleString()} rows · updated ${formatDistanceToNow(new Date(d.updated_at ?? d.created_at), { addSuffix: true })}`,
  }));

  return (
    <div className="grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-10">
        <Section title="Recent dashboards" href="/dashboards" linkLabel="All dashboards">
          <RowList
            items={recentDashboards}
            icon={LayoutDashboard}
            empty={
              <>
                No dashboards yet.{" "}
                <Link href="/templates" className="text-highlight hover:underline">
                  Start from a template
                </Link>{" "}
                or build one from your data.
              </>
            }
          />
        </Section>
        <Section title="Your data" href="/data" linkLabel="All data">
          <RowList items={recentData} icon={FileSpreadsheet} empty="No datasets yet. Upload a CSV or Excel file, or connect a database." />
        </Section>
      </div>
      <div className="flex min-w-0 flex-col gap-10">
        <YourTasks />
        <TeamActivity />
      </div>
    </div>
  );
}
