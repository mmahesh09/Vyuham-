"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { datasetKeys } from "@/features/datasets/api";
import { api } from "@/lib/api/client";

/** Mirrors backend/app/routers/metrics.py. */
export type MetricFormat = "number" | "currency" | "percent";

export type Metric = {
  id: string;
  name: string;
  dataset_id: string;
  description: string | null;
  format: MetricFormat;
  currency: string | null;
  unit: string | null;
  default_date_column: string | null;
  synonyms: string[];
  owner_id: string | null;
  /** The newest version. */
  formula: string;
  version: number;
  approved_version: number | null;
  /** What charts, alerts and Ask use today. */
  approved_formula: string | null;
  created_at: string;
  updated_at: string;
};

export type MetricDetails = Pick<Metric, "description" | "format" | "currency" | "unit" | "default_date_column" | "synonyms"> & { name: string };
export type MetricVersion = { id: string; version: number; formula: string; effective_from: string; note: string | null; created_at: string };
export type MetricTestFilter = { field: string; op: "eq"; value: string };
export type MetricTest = { id: string; name: string; filters: MetricTestFilter[]; expected: number | null; tolerance: number };
export type MetricTestResult = { id: string; name: string; status: "passed" | "failed" | "error"; expected: number | null; actual: number | null; message: string | null };
export type Dimension = { id: string; name: string; dataset_id: string; column: string; description: string | null; synonyms: string[] };
export type CalculatedColumn = { id: string; dataset_id: string; name: string; formula: string; type: string | null; error: string | null };
export type FormulaFunction = { name: string; signature: string; group: string; help: string };
export type FormulaKind = "measure" | "column";
export type FormulaInput = { dataset_id: string; formula: string; kind: FormulaKind; metric_id?: string; column_id?: string; group_by?: string };
export type FormulaCheck = { ok: boolean; type: string | null; error: { message: string; start: number; end: number } | null; columns: string[]; metrics: string[] };

const json = (body: unknown) => JSON.stringify(body);

export const metricKeys = {
  all: ["metrics"] as const,
  versions: (id: string) => ["metrics", id, "versions"] as const,
  tests: (id: string) => ["metrics", id, "tests"] as const,
  dimensions: ["dimensions"] as const,
  columns: ["calculated-columns"] as const,
  functions: ["formula-functions"] as const,
};

export const isApproved = (m: Metric) => m.approved_formula !== null;

export function useMetrics() {
  return useQuery({ queryKey: metricKeys.all, queryFn: () => api<Metric[]>("/metrics") });
}

/** Approved metrics a chart or alert on this dataset can use. */
export function useApprovedMetrics(datasetId: string | undefined) {
  const { data } = useMetrics();
  return (data ?? []).filter((m) => m.dataset_id === datasetId && isApproved(m));
}

export function useFormulaFunctions() {
  return useQuery({ queryKey: metricKeys.functions, queryFn: () => api<FormulaFunction[]>("/formulas/functions"), staleTime: Infinity });
}

export const checkFormula = (input: FormulaInput, signal?: AbortSignal) =>
  api<FormulaCheck>("/formulas/validate", { method: "POST", body: json(input), signal });
export const previewFormula = (input: FormulaInput, signal?: AbortSignal) =>
  api<{ rows: Record<string, string | number | null>[] }>("/formulas/preview", { method: "POST", body: json(input), signal });
export const metricSql = (id: string) => api<{ sql: string }>(`/metrics/${id}/sql`);

function useRefresh() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: metricKeys.all });
    void client.invalidateQueries({ queryKey: metricKeys.columns });
    void client.invalidateQueries({ queryKey: metricKeys.dimensions });
  };
}

export function useCreateMetric() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: MetricDetails & { dataset_id: string; formula: string; effective_from?: string }) => api<Metric>("/metrics", { method: "POST", body: json(input) }),
    onSuccess: refresh,
  });
}

export function useUpdateMetric(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: MetricDetails) => api<Metric>(`/metrics/${id}`, { method: "PUT", body: json(input) }),
    onSuccess: refresh,
  });
}

export function useAddVersion(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: { formula: string; effective_from?: string; note?: string }) => api<Metric>(`/metrics/${id}/versions`, { method: "POST", body: json(input) }),
    onSuccess: refresh,
  });
}

export function useApproveMetric(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => api<Metric>(`/metrics/${id}/approve`, { method: "POST" }), onSuccess: refresh });
}

export function useDeleteMetric() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => api<void>(`/metrics/${id}`, { method: "DELETE" }), onSuccess: refresh });
}

export function useMetricVersions(id: string) {
  return useQuery({ queryKey: [...metricKeys.versions(id)], queryFn: () => api<MetricVersion[]>(`/metrics/${id}/versions`) });
}

export function useMetricTests(id: string) {
  return useQuery({ queryKey: metricKeys.tests(id), queryFn: () => api<MetricTest[]>(`/metrics/${id}/tests`) });
}

export function useAddMetricTest(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; expected: number | null; tolerance: number; filters: MetricTestFilter[] }) =>
      api<MetricTest>(`/metrics/${id}/tests`, { method: "POST", body: json(input) }),
    onSuccess: () => client.invalidateQueries({ queryKey: metricKeys.tests(id) }),
  });
}

export function useDeleteMetricTest(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (testId: string) => api<void>(`/metrics/${id}/tests/${testId}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: metricKeys.tests(id) }),
  });
}

export function useRunMetricTests(id: string) {
  return useMutation({ mutationFn: () => api<MetricTestResult[]>(`/metrics/${id}/tests/run`, { method: "POST" }) });
}

export function useDimensions() {
  return useQuery({ queryKey: metricKeys.dimensions, queryFn: () => api<Dimension[]>("/dimensions") });
}

export function useCreateDimension() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: { name: string; dataset_id: string; column: string; description: string | null; synonyms: string[] }) =>
      api<Dimension>("/dimensions", { method: "POST", body: json(input) }),
    onSuccess: refresh,
  });
}

export function useDeleteDimension() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => api<void>(`/dimensions/${id}`, { method: "DELETE" }), onSuccess: refresh });
}

export function useCalculatedColumns() {
  return useQuery({ queryKey: metricKeys.columns, queryFn: () => api<CalculatedColumn[]>("/calculated-columns") });
}

export function useSaveCalculatedColumn() {
  const client = useQueryClient();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...input }: { id?: string; dataset_id: string; name: string; formula: string }) =>
      api<CalculatedColumn>(id ? `/calculated-columns/${id}` : "/calculated-columns", { method: id ? "PUT" : "POST", body: json(input) }),
    onSuccess: () => {
      refresh();
      void client.invalidateQueries({ queryKey: datasetKeys.all });
    },
  });
}

export function useDeleteCalculatedColumn() {
  const client = useQueryClient();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/calculated-columns/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      void client.invalidateQueries({ queryKey: datasetKeys.all });
    },
  });
}
