"use client";

import { ArrowLeft, Copy, Hash, LayoutGrid, ListTodo, LoaderCircle, MoreHorizontal, Newspaper, Plus, Sparkle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useMemo, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ChartBuilder } from "@/features/charts/chart-builder";
import { TaskDialog } from "@/features/team/task-dialog";
import { ExportMenu } from "@/features/reports/export-menu";
import { cn } from "@/lib/utils";

import { privateSource, publicSource, type ChartKind, type ChartRecord, type Dashboard, type DashboardSource } from "./api";
import { CanvasView } from "./canvas-view";
import { FilterBar } from "./filter-bar";
import { toViewQuery, useDashboardFilters } from "./filters";
import { useDashboardMeta, useDashboardMutations, useDashboardView, useDeleteDashboard, useDuplicateDashboard } from "./hooks";
import { KpiGrid } from "./kpi-grid";
import { SettingsDialog } from "./settings-dialog";
import { ShareDialog } from "./share-dialog";
import { useDashboardLayout } from "./store";
import { StoryFeed } from "./story-feed";

/** Signed-in dashboard: everything, editable by editors. */
export function DashboardScreen({ id }: { id: string }) {
  const source = useMemo(() => privateSource(id), [id]);
  return <DashboardBody source={source} mode="private" />;
}

/** Public share link: read-only, no app chrome. */
export function PublicDashboardScreen({ token }: { token: string }) {
  const source = useMemo(() => publicSource(token), [token]);
  return <DashboardBody source={source} mode="public" />;
}

function DashboardBody({ source, mode }: { source: DashboardSource; mode: "private" | "public" }) {
  const meta = useDashboardMeta(source);
  if (meta.isPending)
    return (
      <div className="flex h-64 items-center justify-center text-faint">
        <LoaderCircle className="size-5 animate-spin" aria-label="Loading dashboard" />
      </div>
    );
  if (meta.isError)
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col items-start gap-4 pt-10">
        <p role="alert" className="text-muted">
          {meta.error.message === "Dashboard not found" ? "This dashboard doesn't exist, or it was deleted." : meta.error.message}
        </p>
        {mode === "private" && (
          <Button variant="outline" nativeButton={false} render={<Link href="/dashboards" />}>
            <ArrowLeft /> All dashboards
          </Button>
        )}
      </div>
    );
  return <Loaded dashboard={meta.data} source={source} mode={mode} />;
}

function Loaded({ dashboard, source, mode }: { dashboard: Dashboard; source: DashboardSource; mode: "private" | "public" }) {
  const router = useRouter();
  const canEdit = mode === "private" && dashboard.can_edit;
  const [filters] = useDashboardFilters();
  const chartIds = dashboard.charts.map((c) => c.id).join(",");
  const viewQuery = toViewQuery(filters);
  const view = useDashboardView(source, viewQuery, chartIds);
  const views = useMemo(() => new Map((view.data?.charts ?? []).map((c) => [c.id, c])), [view.data]);
  const m = useDashboardMutations(dashboard.id);
  const duplicate = useDuplicateDashboard();
  const remove = useDeleteDashboard();
  const { editing, setEditing } = useDashboardLayout();
  const [layoutMode, setLayoutMode] = useQueryState("layout", parseAsStringLiteral(["story", "canvas"] as const).withDefault("story"));
  const canvas = layoutMode === "canvas";
  useEffect(() => () => setEditing(false), [setEditing]);

  const [builder, setBuilder] = useState<{ open: boolean; chart: ChartRecord | null; kind: ChartKind }>({ open: false, chart: null, kind: "card" });
  const [confirmDelete, setConfirmDelete] = useState<ChartRecord | "dashboard" | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);

  const kpis = dashboard.charts.filter((c) => c.kind === "kpi");
  const cards = dashboard.charts.filter((c) => c.kind === "card");
  const hasDates = Object.keys(dashboard.date_fields).length > 0;
  const actionsFor = (chart: ChartRecord) => ({
    onEdit: () => setBuilder({ open: true, chart, kind: chart.kind }),
    onDelete: () => setConfirmDelete(chart),
  });
  const saveError = (builder.chart ? m.updateChart.error : m.addChart.error)?.message ?? null;

  // Summary: the three most telling sentences from the cards.
  const summary = cards
    .map((c) => views.get(c.id)?.insight)
    .filter((i): i is NonNullable<typeof i> => !!i)
    .sort((a, b) => Number(b.trend !== "flat") - Number(a.trend !== "flat"))
    .slice(0, 3);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-7 pt-2">
      {mode === "private" && (
        <Link href="/dashboards" className="inline-flex w-fit items-center gap-1.5 text-sm text-faint hover:text-text">
          <ArrowLeft className="size-4" aria-hidden /> All dashboards
        </Link>
      )}

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-[clamp(28px,3.6vw,38px)] font-semibold tracking-[-0.03em]">{dashboard.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-[14px] text-muted">
            {dashboard.description || (dashboard.datasets.length ? `From ${dashboard.datasets.map((d) => d.name).join(", ")}` : "No data yet")}
            {view.isFetching && <LoaderCircle className="size-3.5 animate-spin text-highlight" aria-label="Updating" />}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {dashboard.charts.length > 0 && (
            <div role="group" aria-label="Layout" className="flex rounded-lg border border-line p-0.5" data-tour="layout-toggle">
              {(
                [
                  ["story", "Story", Newspaper],
                  ["canvas", "Canvas", LayoutGrid],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={layoutMode === value}
                  onClick={() => (setEditing(false), void setLayoutMode(value === "story" ? null : value))}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium",
                    layoutMode === value ? "bg-line text-text" : "text-muted hover:text-text",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden /> {label}
                </button>
              ))}
            </div>
          )}
        {mode === "private" && dashboard.charts.length > 0 && (
          <ExportMenu source="dashboard" sourceId={dashboard.id} options={{ date_from: viewQuery.from, date_to: viewQuery.to, filters: viewQuery.f }} />
        )}
        {canEdit && (
          <>
            <Button onClick={() => setBuilder({ open: true, chart: null, kind: "card" })}>
              <Plus /> Add chart
            </Button>
            <Button variant="outline" onClick={() => setBuilder({ open: true, chart: null, kind: "kpi" })}>
              <Hash /> Add number
            </Button>
            <ShareDialog dashboard={dashboard} />
            {(canvas ? dashboard.charts.length > 0 : kpis.length > 0) && (
              <Button variant={editing ? "default" : "outline"} onClick={() => setEditing(!editing)} aria-pressed={editing}>
                {editing ? "Done" : canvas ? "Arrange" : "Arrange numbers"}
              </Button>
            )}
            <SettingsDialog dashboard={dashboard} />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More dashboard actions" />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setTaskOpen(true)}>
                  <ListTodo /> Assign a task
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => duplicate.mutate(dashboard.id, { onSuccess: (d) => router.push(`/dashboards/${d.id}`) })}>
                  <Copy /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete("dashboard")}>
                  <Trash2 /> Delete dashboard
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        </div>
      </header>

      {dashboard.charts.length > 0 && (hasDates || dashboard.filter_columns.length > 0) && (
        <FilterBar source={source} columns={dashboard.filter_columns} hasDates={hasDates} />
      )}

      {view.isError && <p role="alert" className="text-sm text-accent">{view.error.message}</p>}

      {dashboard.charts.length === 0 ? (
        <Empty className="border border-dashed border-line py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Sparkle />
            </EmptyMedia>
            <EmptyTitle>This dashboard is empty</EmptyTitle>
            <EmptyDescription>
              {canEdit ? "Add a chart or a key number from one of your datasets." : "Nothing has been added here yet."}
            </EmptyDescription>
          </EmptyHeader>
          {canEdit && (
            <EmptyContent className="flex-row justify-center">
              <Button onClick={() => setBuilder({ open: true, chart: null, kind: "card" })}>
                <Plus /> Add chart
              </Button>
              <Button variant="outline" onClick={() => setBuilder({ open: true, chart: null, kind: "kpi" })}>
                <Hash /> Add number
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : canvas ? (
        <>
          {editing && <p className="-mt-3 text-[13px] text-faint">Drag tiles by the handle and resize from the edges. The canvas layout is saved for everyone and doesn&apos;t change the story order.</p>}
          <CanvasView
            charts={dashboard.charts}
            views={views}
            layout={dashboard.canvas_layout ?? []}
            editing={editing}
            canEdit={canEdit}
            onLayoutChange={canEdit ? (canvas_layout) => m.update.mutate({ canvas_layout }) : undefined}
            actionsFor={actionsFor}
          />
        </>
      ) : (
        <>
          <KpiGrid
            charts={kpis}
            views={views}
            layout={dashboard.kpi_layout}
            editing={editing}
            canEdit={canEdit}
            allTime={!filters.from}
            onLayoutChange={canEdit ? (kpi_layout) => m.update.mutate({ kpi_layout }) : undefined}
            actionsFor={actionsFor}
          />
          {editing && <p className="-mt-4 text-[13px] text-faint">Drag a tile by its handle or widen it from its right edge. Saved for everyone.</p>}

          {summary.length > 0 && (
            <section aria-labelledby="changed-heading" className="rounded-[18px] bg-line p-6 sm:p-7">
              <h2 id="changed-heading" className="flex items-center gap-2.5 text-[19px] font-semibold">
                <Sparkle className="size-4 text-highlight" strokeWidth={2.2} aria-hidden />
                What stands out
              </h2>
              <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-6 text-[16px] leading-relaxed text-text/90">
                {summary.map((s) => (
                  <li key={s.headline}>
                    {s.headline}
                    {s.note && <span className="text-muted"> — {s.note}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className={cn(view.isPlaceholderData && "opacity-80 transition-opacity")}>
            <StoryFeed charts={cards} views={views} canEdit={canEdit} onReorder={canEdit ? (ids) => m.reorder.mutate([...kpis.map((k) => k.id), ...ids]) : undefined} actionsFor={actionsFor} />
          </div>
        </>
      )}

      {mode === "public" && (
        <p className="pb-6 text-center text-xs text-faint">
          Read-only dashboard shared from{" "}
          <Link href="/" className="text-highlight hover:underline">
            Vyuham
          </Link>
          .
        </p>
      )}

      {canEdit && (
        <>
          <ChartBuilder
            open={builder.open}
            onOpenChange={(open) => {
              setBuilder((b) => ({ ...b, open }));
              if (!open) {
                m.addChart.reset();
                m.updateChart.reset();
              }
            }}
            chart={builder.chart}
            defaultKind={builder.kind}
            defaultDatasetId={dashboard.datasets[0]?.id}
            saving={m.addChart.isPending || m.updateChart.isPending}
            error={saveError}
            onSave={(body) => {
              const done = { onSuccess: () => setBuilder((b) => ({ ...b, open: false })) };
              if (builder.chart) m.updateChart.mutate({ chartId: builder.chart.id, ...body }, done);
              else m.addChart.mutate(body, done);
            }}
          />
          <TaskDialog open={taskOpen} onOpenChange={setTaskOpen} canEdit defaults={{ title: `Review ${dashboard.name}`, dashboard_id: dashboard.id }} />
          <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirmDelete === "dashboard" ? `Delete “${dashboard.name}”?` : `Remove “${confirmDelete?.spec.title}”?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmDelete === "dashboard"
                    ? "The dashboard and its charts are deleted for everyone, and any share link stops working. Your datasets stay."
                    : "The chart is removed from this dashboard for everyone. The data behind it stays."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    if (confirmDelete === "dashboard") remove.mutate(dashboard.id, { onSuccess: () => router.replace("/dashboards") });
                    else if (confirmDelete) m.deleteChart.mutate(confirmDelete.id);
                    setConfirmDelete(null);
                  }}
                >
                  {confirmDelete === "dashboard" ? "Delete dashboard" : "Remove chart"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
