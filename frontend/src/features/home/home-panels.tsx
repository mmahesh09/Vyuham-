"use client";

import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ArrowRight, Check, FileSpreadsheet, LayoutDashboard, ListTodo, Users } from "lucide-react";
import Link from "next/link";

import { useMe } from "@/features/auth/hooks";
import { useDashboards } from "@/features/dashboards/hooks";
import { useDatasets } from "@/features/datasets/api";
import { useMembers } from "@/features/profile/api";
import { STATUS_LABEL, useTasks } from "@/features/team/api";
import { cn } from "@/lib/utils";

/** First-run checklist: add data → build a dashboard → invite a teammate. Hidden once all done. */
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

  return (
    <section aria-labelledby="start-heading" className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="start-heading" className="text-[20px] font-semibold">
          Get set up
        </h2>
        <span className="text-sm text-faint">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link
              href={s.href}
              className={cn(
                "flex h-full items-start gap-3 rounded-xl border border-line p-4 transition-colors hover:border-primary/60",
                s.done && "opacity-70",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                  s.done ? "bg-[#6bb700] text-bg" : "bg-line text-highlight",
                )}
                aria-hidden
              >
                {s.done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className={cn("text-[15px] font-semibold", s.done && "line-through decoration-faint")}>{s.title}</span>
                <span className="text-[13px] text-muted">{s.done ? "Done" : s.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Recently updated dashboards and datasets. */
export function RecentWork() {
  const { data: dashboards } = useDashboards();
  const { data: datasets } = useDatasets();
  if (!dashboards?.length && !datasets?.length) return null;

  const block = (title: string, href: string, items: { id: string; name: string; meta: string; href: string }[], Icon: typeof LayoutDashboard) => (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        <Link href={href} className="text-sm text-highlight hover:underline">
          See all
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-faint">Nothing yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
          {items.map((it) => (
            <li key={it.id}>
              <Link href={it.href} className="group flex items-center gap-3 px-4 py-3 hover:bg-surface">
                <Icon className="size-4 shrink-0 text-highlight" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-medium">{it.name}</span>
                  <span className="truncate text-xs text-faint">{it.meta}</span>
                </span>
                <ArrowRight className="size-4 text-faint group-hover:text-text" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="grid gap-8 md:grid-cols-2">
      {block(
        "Recent dashboards",
        "/dashboards",
        (dashboards ?? []).slice(0, 4).map((d) => ({
          id: d.id,
          name: d.name,
          href: `/dashboards/${d.id}`,
          meta: `${d.kpi_count + d.chart_count} charts · updated ${formatDistanceToNow(new Date(d.updated_at), { addSuffix: true })}`,
        })),
        LayoutDashboard,
      )}
      {block(
        "Your data",
        "/data",
        (datasets ?? []).slice(0, 4).map((d) => ({
          id: d.id,
          name: d.name,
          href: `/data/${d.id}`,
          meta: `${d.row_count.toLocaleString()} rows · ${formatDistanceToNow(new Date(d.updated_at ?? d.created_at), { addSuffix: true })}`,
        })),
        FileSpreadsheet,
      )}
    </div>
  );
}

/** Open tasks assigned to me, soonest due first. */
export function MyTasks() {
  const { data: me } = useMe();
  const { data: tasks } = useTasks();
  const mine = (tasks ?? [])
    .filter((t) => t.assignee_id === me?.id && t.status !== "done")
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
    .slice(0, 5);
  if (!mine.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold">Your tasks</h2>
        <Link href="/team" className="text-sm text-highlight hover:underline">
          Open board
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
        {mine.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-4 py-3">
            <ListTodo className="size-4 shrink-0 text-highlight" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[15px]">{t.title}</span>
            <span className="text-xs text-faint">{STATUS_LABEL[t.status]}</span>
            {t.due_date && (
              <span className={cn("text-xs", t.due_date < today ? "font-semibold text-accent" : "text-muted")}>
                due {format(parseISO(t.due_date), "MMM d")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
