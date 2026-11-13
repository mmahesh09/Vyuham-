"use client";

import { Copy, Hash, LayoutDashboard, LayoutGrid, ListTodo, LoaderCircle, Move, MoreHorizontal, Newspaper, Plus, SlidersHorizontal, Sparkle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { InlineAlert } from "@/components/app/inline-alert";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { SegmentedControl } from "@/components/app/segmented-control";
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
      <div className="flex h-64 items-center justify-center text-faint" role="status">
        <LoaderCircle className="size-5 animate-spin" aria-hidden />
        <span className="sr-only">Loading dashboard</span>
      </div>
    );
  if (meta.isError)
    return (
      <PageContainer className="pt-6">
        <EmptyState
          icon={<LayoutDashboard />}
          title={meta.error.message === "Dashboard not found" ? "This dashboard doesn't exist" : "We couldn't open this dashboard"}
          description={meta.error.message === "Dashboard not found" ? "It may have been deleted, or the link is wrong." : meta.error.message}
          action={
            mode === "private" ? (
              <Button variant="outline" nativeButton={false} render={<Link href="/dashboards" />}>
                All dashboards
              </Button>
            ) : undefined
          }
        />
      </PageContainer>
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
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    <PageContainer width={canvas ? "wide" : "default"} className="gap-7">
      <PageHeader
        back={mode === "private" ? { href: "/dashboards", label: "All dashboards" } : undefined}
        crumb={dashboard.name}
        title={dashboard.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {dashboard.description || (dashboard.datasets.length ? `From ${dashboard.datasets.map((d) => d.name).join(", ")}` : "No data yet")}
            {view.isFetching && (
              <span role="status" className="flex items-center">
                <LoaderCircle className="size-3.5 animate-spin text-highlight" aria-hidden />
                <span className="sr-only">Updating</span>
              </span>
            )}
          </span>
        }
        actions={
          <>
            {mode === "private" && dashboard.charts.length > 0 && (
              <ExportMenu source="dashboard" sourceId={dashboard.id} options={{ date_from: viewQuery.from, date_to: viewQuery.to, filters: viewQuery.f }} />
            )}
            {canEdit && (
              <>
                <ShareDialog dashboard={dashboard} />
                {editing ? (
                  <Button onClick={() => setEditing(false)}>Done arranging</Button>
                ) : (
                  <Button onClick={() => setBuilder({ open: true, chart: null, kind: "card" })}>
                    <Plus /> Add chart
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More dashboard actions" />}>
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => setBuilder({ open: true, chart: null, kind: "kpi" })}>
                      <Hash /> Add a key number
                    </DropdownMenuItem>
                    {(canvas ? dashboard.charts.length > 0 : kpis.length > 0) && (
                      <DropdownMenuItem onClick={() => setEditing(!editing)}>
                        <Move /> {editing ? "Stop arranging" : canvas ? "Arrange tiles" : "Arrange numbers"}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                      <SlidersHorizontal /> Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
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
          </>
        }
      >
        {dashboard.charts.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <div data-tour="layout-toggle">
              <SegmentedControl
                label="Layout"
                value={layoutMode}
                onChange={(v) => (setEditing(false), void setLayoutMode(v === "story" ? null : v))}
                options={[
                  { value: "story", label: "Story", icon: <Newspaper className="size-3.5" aria-hidden /> },
                  { value: "canvas", label: "Canvas", icon: <LayoutGrid className="size-3.5" aria-hidden /> },
                ]}
              />
            </div>
            {(hasDates || dashboard.filter_columns.length > 0) && (
              <FilterBar source={source} columns={dashboard.filter_columns} hasDates={hasDates} />
            )}
          </div>
        )}
      </PageHeader>

      {view.isError && <InlineAlert>{view.error.message}</InlineAlert>}

      {dashboard.charts.length === 0 ? (
        <EmptyState
          icon={<Sparkle />}
          title="This dashboard is empty"
          description={canEdit ? "Add a chart or a key number from one of your datasets." : "Nothing has been added here yet."}
          action={
            canEdit ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setBuilder({ open: true, chart: null, kind: "card" })}>
                  <Plus /> Add chart
                </Button>
                <Button variant="outline" onClick={() => setBuilder({ open: true, chart: null, kind: "kpi" })}>
                  <Hash /> Add a key number
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : canvas ? (
        <>
          {editing && <p className="-mt-3 text-[13px] text-muted">Drag tiles by the handle and resize from the edges. The canvas layout is saved for everyone and doesn&apos;t change the story order.</p>}
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
          {editing && <p className="-mt-4 text-[13px] text-muted">Drag a tile by its handle or widen it from its right edge. Saved for everyone.</p>}

          {summary.length > 0 && (
            <section aria-labelledby="changed-heading" className="rounded-xl border border-line-strong bg-surface-2/50 px-5 py-5 sm:px-6">
              <h2 id="changed-heading" className="type-section flex items-center gap-2">
                <Sparkle className="size-4 text-highlight" strokeWidth={2.2} aria-hidden />
                What stands out
              </h2>
              <ul className="mt-3 flex flex-col gap-3">
                {summary.map((s) => (
                  <li key={s.headline} className="flex max-w-[72ch] flex-col gap-0.5 border-l-2 border-line-strong pl-3.5">
                    <span className="text-[15.5px] leading-snug text-text">{s.headline}</span>
                    {s.note && <span className="text-[13.5px] text-muted">{s.note}</span>}
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
          <SettingsDialog dashboard={dashboard} open={settingsOpen} onOpenChange={setSettingsOpen} />
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
    </PageContainer>
  );
}
