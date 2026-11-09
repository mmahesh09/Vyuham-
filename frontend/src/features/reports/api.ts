"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";

/** Mirrors backend/app/routers/reports.py. */
export type ReportSource = "dashboard" | "saved_query" | "dataset";
export type ReportFormat = "pdf" | "csv" | "xlsx";
export type RunStatus = "queued" | "running" | "retry" | "done" | "failed";

export type ReportOptions = {
  /** Dashboards: a fixed range ("yyyy-MM-dd"), as on screen when exporting. */
  date_from?: string | null;
  date_to?: string | null;
  /** Dashboards: the last N days, counted from each run; null (and no fixed range) = all time. */
  period_days: number | null;
  /** Dashboards: column = value. */
  filters: Record<string, string>;
  orientation: "portrait" | "landscape";
  page_size: "A4" | "Letter";
};

export type ReportRun = {
  id: string;
  report_id: string | null;
  name: string;
  source: ReportSource;
  source_id: string;
  format: ReportFormat;
  status: RunStatus;
  trigger: "manual" | "schedule";
  file_name: string | null;
  size_bytes: number | null;
  rows: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type Report = {
  id: string;
  name: string;
  source: ReportSource;
  source_id: string;
  source_name: string | null;
  format: ReportFormat;
  options: ReportOptions;
  created_at: string;
  updated_at: string;
  last_run: ReportRun | null;
};

export type ExportInput = { name?: string | null; source: ReportSource; source_id: string; format: ReportFormat; options: ReportOptions };
export type ReportInput = ExportInput & { name: string };

export const DEFAULT_OPTIONS: ReportOptions = { period_days: null, filters: {}, orientation: "portrait", page_size: "A4" };
export const FORMAT_LABEL: Record<ReportFormat, string> = { pdf: "PDF", csv: "CSV", xlsx: "Excel" };
export const SOURCE_LABEL: Record<ReportSource, string> = { dashboard: "Dashboard", saved_query: "Saved query", dataset: "Dataset" };

export const isActive = (r: Pick<ReportRun, "status">) => r.status === "queued" || r.status === "running" || r.status === "retry";
export const downloadUrl = (runId: string) => `/api/report-runs/${runId}/download`;

/** While anything is still being generated, check again every 2 seconds. */
const pollWhileActive = (runs: ReportRun[] | undefined) => (runs?.some(isActive) ? 2000 : false);

export function useReports() {
  return useQuery({
    queryKey: ["reports"],
    queryFn: () => api<Report[]>("/reports"),
    refetchInterval: (q) => pollWhileActive(q.state.data?.flatMap((r) => (r.last_run ? [r.last_run] : []))),
  });
}

export function useReportRuns(reportId?: string) {
  return useQuery({
    queryKey: ["report-runs", reportId ?? "all"],
    queryFn: () => api<ReportRun[]>(`/report-runs${reportId ? `?report_id=${reportId}` : ""}`),
    refetchInterval: (q) => pollWhileActive(q.state.data),
  });
}

/** One run, refreshed until its file is ready (or it failed). */
export function useReportRun(runId: string | null) {
  return useQuery({
    queryKey: ["report-run", runId],
    queryFn: () => api<ReportRun>(`/report-runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data && !isActive(q.state.data) ? false : 1500),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["reports"] }), qc.invalidateQueries({ queryKey: ["report-runs"] })]);
}

export function useExport() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: ExportInput) => api<ReportRun>("/exports", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });
}

export function useSaveReport() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: ReportInput & { id?: string }) =>
      api<Report>(id ? `/reports/${id}` : "/reports", { method: id ? "PUT" : "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });
}

export function useDeleteReport() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api<void>(`/reports/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useRunReport() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api<ReportRun>(`/reports/${id}/run`, { method: "POST" }), onSuccess: invalidate });
}

export function formatBytes(n: number | null) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
