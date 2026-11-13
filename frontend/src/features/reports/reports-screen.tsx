"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Download, FileText, LoaderCircle, Pencil, Play, Trash2 } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/features/auth/hooks";
import { useDashboards } from "@/features/dashboards/hooks";
import { useDatasets } from "@/features/datasets/api";
import { api } from "@/lib/api/client";

import {
  DEFAULT_OPTIONS,
  FORMAT_LABEL,
  SOURCE_LABEL,
  downloadUrl,
  formatBytes,
  isActive,
  useDeleteReport,
  useReportRuns,
  useReports,
  useRunReport,
  useSaveReport,
  type Report,
  type ReportFormat,
  type ReportInput,
  type ReportRun,
  type ReportSource,
} from "./api";

const TABS = ["reports", "history"] as const;
const PERIODS: { value: number | null; label: string }[] = [
  { value: null, label: "All time" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 365, label: "Last 12 months" },
];
const STATUS_BADGE: Record<ReportRun["status"], [variant: "success-light" | "warning-light" | "destructive-light" | "outline", label: string]> = {
  queued: ["outline", "Queued"],
  running: ["warning-light", "Generating"],
  retry: ["warning-light", "Retrying"],
  done: ["success-light", "Ready"],
  failed: ["destructive-light", "Failed"],
};

type Option = { id: string; name: string };

/** Everything a report can be made from, by kind. Saved queries are listed for owners and editors only. */
function useSources(canEdit: boolean): Record<ReportSource, Option[] | undefined> {
  const { data: dashboards } = useDashboards();
  const { data: datasets } = useDatasets();
  const { data: queries } = useQuery({
    queryKey: ["sql", "saved"],
    queryFn: () => api<Option[]>("/sql/saved"),
    enabled: canEdit,
  });
  return { dashboard: dashboards, dataset: datasets, saved_query: canEdit ? queries : [] };
}

// ---------- editor ----------

function ReportDialog({ open, onOpenChange, report, sources }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  report: Report | null;
  sources: Record<ReportSource, Option[] | undefined>;
}) {
  const save = useSaveReport();
  const [form, setForm] = useState<ReportInput | null>(null);

  useEffect(() => {
    if (!open) return;
    save.reset();
    if (report) {
      setForm({ name: report.name, source: report.source, source_id: report.source_id, format: report.format, options: { ...DEFAULT_OPTIONS, ...report.options } });
      return;
    }
    const first = sources.dashboard?.[0];
    setForm({ name: "", source: first ? "dashboard" : "dataset", source_id: first?.id ?? sources.dataset?.[0]?.id ?? "", format: first ? "pdf" : "xlsx", options: { ...DEFAULT_OPTIONS, period_days: 30 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, report]);

  if (!form) return null;
  const set = (patch: Partial<ReportInput>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setOptions = (patch: Partial<ReportInput["options"]>) => setForm((f) => (f ? { ...f, options: { ...f.options, ...patch } } : f));
  const isDashboard = form.source === "dashboard";
  const formats: ReportFormat[] = isDashboard ? ["pdf", "xlsx", "csv"] : ["xlsx", "csv"];
  const kinds = (Object.keys(SOURCE_LABEL) as ReportSource[]).filter((k) => sources[k]?.length || k === form.source);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{report ? "Edit report" : "New report"}</DialogTitle>
          <DialogDescription>Save what to export and how, then run it whenever you need a fresh file.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const name = form.name.trim() || sources[form.source]?.find((s) => s.id === form.source_id)?.name || "Untitled report";
            // Saved reports use a rolling period, never a fixed range.
            save.mutate({ ...form, id: report?.id, name, options: { ...form.options, date_from: null, date_to: null } }, { onSuccess: () => onOpenChange(false) });
          }}
        >
          <Field>
            <FieldLabel htmlFor="rp-name">Name</FieldLabel>
            <Input id="rp-name" maxLength={200} placeholder="e.g. Monthly sales pack" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="rp-kind">From</FieldLabel>
              <NativeSelect
 id="rp-kind"
                className="w-full"
                value={form.source}
                onChange={(e) => {
                  const source = e.target.value as ReportSource;
                  set({ source, source_id: sources[source]?.[0]?.id ?? "", format: source === "dashboard" ? form.format : form.format === "pdf" ? "xlsx" : form.format });
                }}
              >
                {kinds.map((k) => (
                  <option key={k} value={k} className="bg-surface">
                    {SOURCE_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="rp-source">{SOURCE_LABEL[form.source]}</FieldLabel>
              <NativeSelect id="rp-source" className="w-full" value={form.source_id} onChange={(e) => set({ source_id: e.target.value })}>
                {sources[form.source]?.map((s) => (
                  <option key={s.id} value={s.id} className="bg-surface">
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field>
            <FieldLabel>Format</FieldLabel>
            <div role="radiogroup" aria-label="Format" className="flex gap-2">
              {formats.map((f) => (
                <Button key={f} type="button" role="radio" aria-checked={form.format === f} variant={form.format === f ? "default" : "outline"} size="sm" onClick={() => set({ format: f })}>
                  {FORMAT_LABEL[f]}
                </Button>
              ))}
            </div>
            <FieldDescription>
              {form.format === "pdf" ? "The dashboard as it looks on screen." : form.format === "xlsx" ? (isDashboard ? "A summary sheet and a sheet per chart." : "Every row, in one sheet.") : isDashboard ? "One CSV per chart, in a .zip." : "Every row, as plain text."}
            </FieldDescription>
          </Field>
          {isDashboard && (
            <Field>
              <FieldLabel htmlFor="rp-period">Period</FieldLabel>
              <NativeSelect
 id="rp-period"
                className="w-full"
                value={form.options.period_days ?? ""}
                onChange={(e) => setOptions({ period_days: e.target.value ? Number(e.target.value) : null })}
              >
                {PERIODS.map((p) => (
                  <option key={p.label} value={p.value ?? ""} className="bg-surface">
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
              <FieldDescription>Counted back from the day the report runs. Applies to dashboards with a date column.</FieldDescription>
            </Field>
          )}
          {form.format === "pdf" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="rp-orient">Orientation</FieldLabel>
                <NativeSelect id="rp-orient" className="w-full" value={form.options.orientation} onChange={(e) => setOptions({ orientation: e.target.value as "portrait" | "landscape" })}>
                  <option value="portrait" className="bg-surface">Portrait</option>
                  <option value="landscape" className="bg-surface">Landscape</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="rp-size">Paper</FieldLabel>
                <NativeSelect id="rp-size" className="w-full" value={form.options.page_size} onChange={(e) => setOptions({ page_size: e.target.value as "A4" | "Letter" })}>
                  <option value="A4" className="bg-surface">A4</option>
                  <option value="Letter" className="bg-surface">US Letter</option>
                </NativeSelect>
              </Field>
            </div>
          )}
          {save.error && <p role="alert" className="text-sm text-accent">{save.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !form.source_id}>
              {save.isPending && <LoaderCircle className="animate-spin" />} {report ? "Save" : "Create report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- shared bits ----------

function RunStatus({ run }: { run: ReportRun }) {
  const [variant, label] = STATUS_BADGE[run.status];
  return (
    <Badge variant={variant} size="sm">
      {isActive(run) && <LoaderCircle className="size-3 animate-spin" aria-hidden />} {label}
    </Badge>
  );
}

function DownloadButton({ run }: { run: ReportRun }) {
  if (run.status !== "done") return null;
  return (
    <Button variant="outline" size="sm" nativeButton={false} render={<a href={downloadUrl(run.id)} download={run.file_name ?? undefined} />}>
      <Download /> {FORMAT_LABEL[run.format]}
    </Button>
  );
}

function runDetail(run: ReportRun) {
  if (run.status === "failed") return run.error ?? "Failed";
  if (run.status !== "done") return `Started ${formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}`;
  const parts = [run.file_name, formatBytes(run.size_bytes), run.rows ? `${run.rows.toLocaleString()} rows` : null];
  return `${parts.filter(Boolean).join(" · ")} · ${formatDistanceToNow(new Date(run.finished_at ?? run.created_at), { addSuffix: true })}`;
}

// ---------- screen ----------

export function ReportsScreen() {
  const { data: me } = useMe();
  const canEdit = me?.role !== "viewer";
  const sources = useSources(canEdit);
  const reports = useReports();
  const runs = useReportRuns();
  const runReport = useRunReport();
  const del = useDeleteReport();
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("reports"));
  const [dialog, setDialog] = useState<{ open: boolean; report: Report | null }>({ open: false, report: null });
  const hasSources = !!(sources.dashboard?.length || sources.dataset?.length);
  const actionError = (runReport.error ?? del.error)?.message;

  return (
    <PageContainer className="gap-6">
      <PageHeader
        title="Reports"
        description="PDFs of dashboards, and Excel or CSV exports of your data. Files are kept for 30 days."
        actions={
          <>
            {canEdit && (
              <Button onClick={() => setDialog({ open: true, report: null })} disabled={!hasSources}>
                <FileText /> New report
              </Button>
            )}
          </>
        }
      />
      {actionError && <p role="alert" className="text-sm text-accent">{actionError}</p>}

      <Tabs value={tab} onValueChange={(v) => void setTab(v as (typeof TABS)[number])}>
        <TabsList>
          <TabsTrigger value="reports">Saved reports</TabsTrigger>
          <TabsTrigger value="history">Files</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="pt-4">
          {reports.isPending ? null : !reports.data?.length ? (
            <Empty className="border border-dashed border-line py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText />
                </EmptyMedia>
                <EmptyTitle>No saved reports yet</EmptyTitle>
                <EmptyDescription>
                  e.g. a PDF of the Sales dashboard for the last 30 days. For a one-off file, use Export on any dashboard or saved query.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-[16px] border border-line">
              {reports.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      {r.name}
                      <Badge variant="outline" size="sm">{FORMAT_LABEL[r.format]}</Badge>
                      {r.last_run && <RunStatus run={r.last_run} />}
                    </span>
                    <span className="text-[13px] text-muted">
                      {SOURCE_LABEL[r.source]}: {r.source_name ?? "deleted"}
                      {r.source === "dashboard" && ` · ${PERIODS.find((p) => p.value === (r.options.period_days ?? null))?.label ?? `Last ${r.options.period_days} days`}`}
                    </span>
                    <span className="text-xs text-faint">{r.last_run ? runDetail(r.last_run) : "Not run yet"}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {r.last_run && <DownloadButton run={r.last_run} />}
                    <Button variant="outline" size="sm" disabled={runReport.isPending || !r.source_name || (!!r.last_run && isActive(r.last_run))} onClick={() => runReport.mutate(r.id)}>
                      <Play /> Run now
                    </Button>
                    {canEdit && (
                      <>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.name}`} onClick={() => setDialog({ open: true, report: r })}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.name}`} onClick={() => window.confirm(`Delete the report “${r.name}”? Files already made stay under Files until they expire.`) && del.mutate(r.id)}>
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="history" className="pt-4">
          {!runs.data?.length ? (
            <p className="text-sm text-faint">No files yet. Run a report, or use Export on a dashboard or saved query.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-[16px] border border-line">
              {runs.data.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      {run.name}
                      <RunStatus run={run} />
                      {run.trigger === "schedule" && <Badge variant="outline" size="sm">Scheduled</Badge>}
                    </span>
                    <span className={run.status === "failed" ? "text-[13px] text-accent" : "text-[13px] text-muted"}>{runDetail(run)}</span>
                  </div>
                  <DownloadButton run={run} />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <ReportDialog open={dialog.open} onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))} report={dialog.report} sources={sources} />
    </PageContainer>
  );
}
