"use client";

import { format, formatDistanceToNow, parseISO } from "date-fns";
import { Check, ChevronRight, FileSpreadsheet, LayoutDashboard, ListTodo, Users } from "lucide-react";
import Link from "next/link";

import { Panel } from "@/components/app/panel";
import { useMe } from "@/features/auth/hooks";
import { useDashboards } from "@/features/dashboards/hooks";
import { useDatasets } from "@/features/datasets/api";
import { useMembers } from "@/features/profile/api";
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
    { done: datasets.length > 0, title: "Add your data", hint: "Upload an Excel or CSV file", href: "/data", icon: FileSpreadsheet },
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
        <span className="min-w-0 flex-1 text-[14px]">
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

type Row = { id: string; name: string; meta: string; href: string };

function Section({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-section">{title}</h2>
        <Link href={href} className="text-[13px] text-highlight hover:underline">
          {linkLabel}
        </Link>
      </div>
      {children}
    </section>
  );
}

function RowList({ items, icon: Icon, empty }: { items: Row[]; icon: typeof LayoutDashboard; empty: string }) {
  if (!items.length) return <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-sm text-faint">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {items.map((it) => (
        <li key={it.id}>
          <Link href={it.href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/70">
            <Icon className="size-4 shrink-0 text-faint group-hover:text-highlight" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14.5px] font-medium text-text">{it.name}</span>
              <span className="truncate text-[12.5px] text-faint">{it.meta}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-line-strong group-hover:text-muted" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Recent dashboards and data, plus my open tasks. With tasks: recent work on the left, tasks on the
 * right. Without: dashboards and data side by side.
 */
export function HomeOverview() {
  const { data: me } = useMe();
  const { data: dashboards } = useDashboards();
  const { data: datasets } = useDatasets();
  const { data: tasks } = useTasks();
  if (!dashboards?.length && !datasets?.length) return null;

  const recentDashboards: Row[] = (dashboards ?? []).slice(0, 4).map((d) => ({
    id: d.id,
    name: d.name,
    href: `/dashboards/${d.id}`,
    meta: `${d.kpi_count + d.chart_count} charts · updated ${formatDistanceToNow(new Date(d.updated_at), { addSuffix: true })}`,
  }));
  const recentData: Row[] = (datasets ?? []).slice(0, 4).map((d) => ({
    id: d.id,
    name: d.name,
    href: `/data/${d.id}`,
    meta: `${d.row_count.toLocaleString()} rows · ${formatDistanceToNow(new Date(d.updated_at ?? d.created_at), { addSuffix: true })}`,
  }));
  const mine = (tasks ?? [])
    .filter((t) => t.assignee_id === me?.id && t.status !== "done")
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
    .slice(0, 5);

  const dashboardsSection = (
    <Section title="Recent dashboards" href="/dashboards" linkLabel="All dashboards">
      <RowList items={recentDashboards} icon={LayoutDashboard} empty="No dashboards yet. Build one from a dataset." />
    </Section>
  );
  const dataSection = (
    <Section title="Your data" href="/data" linkLabel="All data">
      <RowList items={recentData} icon={FileSpreadsheet} empty="No datasets yet. Upload a CSV or Excel file." />
    </Section>
  );

  if (!mine.length) {
    return (
      <div className="grid gap-8 md:grid-cols-2">
        {dashboardsSection}
        {dataSection}
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-8">
        {dashboardsSection}
        {dataSection}
      </div>
      <Section title="Your tasks" href="/team" linkLabel="Open board">
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {mine.map((t) => {
            const overdue = !!t.due_date && t.due_date < today;
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
    </div>
  );
}
