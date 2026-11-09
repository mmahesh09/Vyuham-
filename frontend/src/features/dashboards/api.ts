import type { ChartSpec, ResultRow } from "@/features/charts/chart-spec";
import type { DatasetColumn } from "@/features/datasets/api";
import { api } from "@/lib/api/client";

/** Mirrors backend/app/schemas.py. */
export type ChartKind = "card" | "kpi";
export type ChartRecord = { id: string; dataset_id: string | null; spec: ChartSpec; kind: ChartKind; note: string | null; position: number };
export type KpiLayoutItem = { i: string; x: number; y: number; w: number; h: number };

export type Dashboard = {
  id: string;
  name: string;
  description: string | null;
  date_fields: Record<string, string>;
  filter_columns: string[];
  kpi_layout: KpiLayoutItem[];
  /** Dashboard Lab: free-form positions of every chart. */
  canvas_layout: KpiLayoutItem[];
  share_token: string | null;
  created_at: string;
  updated_at: string;
  charts: ChartRecord[];
  datasets: { id: string; name: string; columns: DatasetColumn[] }[];
  can_edit: boolean;
};

export type DashboardSummary = {
  id: string;
  name: string;
  description: string | null;
  chart_count: number;
  kpi_count: number;
  dataset_names: string[];
  shared: boolean;
  updated_at: string;
};

export type Insight = {
  headline: string;
  trend: "up" | "down" | "flat";
  note: string;
  value: number | null;
  previous: number | null;
  change: number | null;
};

export type ChartView = { id: string; rows: ResultRow[]; insight: Insight | null; error: string | null };
export type DashboardView = {
  charts: ChartView[];
  period: { date_from: string; date_to: string; prev_from: string; prev_to: string } | null;
};

/** Filters as sent to the server: dates as "yyyy-MM-dd" (or null = all time) and column equals-filters. */
export type ViewQuery = { from: string | null; to: string | null; f: Record<string, string> };

function viewParams(q: ViewQuery) {
  const p = new URLSearchParams();
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  const f = Object.fromEntries(Object.entries(q.f).filter(([, v]) => v));
  if (Object.keys(f).length) p.set("f", JSON.stringify(f));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * The two sources a dashboard screen can read from: the signed-in API, or a public share link.
 * Both return the same shapes, so the screen renders either.
 */
export type DashboardSource = {
  key: readonly unknown[];
  get: () => Promise<Dashboard>;
  view: (q: ViewQuery) => Promise<DashboardView>;
  values: (column: string) => Promise<string[]>;
};

export const privateSource = (id: string): DashboardSource => ({
  key: ["dashboards", id],
  get: () => api<Dashboard>(`/dashboards/${id}`),
  view: (q) => api<DashboardView>(`/dashboards/${id}/view${viewParams(q)}`),
  values: (c) => api<string[]>(`/dashboards/${id}/filter-values/${encodeURIComponent(c)}`),
});

export const publicSource = (token: string): DashboardSource => ({
  key: ["public-dashboard", token],
  get: () => api<Dashboard>(`/public/dashboards/${token}`),
  view: (q) => api<DashboardView>(`/public/dashboards/${token}/view${viewParams(q)}`),
  values: (c) => api<string[]>(`/public/dashboards/${token}/filter-values/${encodeURIComponent(c)}`),
});

export const dashboardsApi = {
  list: () => api<DashboardSummary[]>("/dashboards"),
  create: (body: { name: string; description?: string | null }) =>
    api<Dashboard>("/dashboards", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: Partial<Pick<Dashboard, "name" | "description" | "date_fields" | "filter_columns" | "kpi_layout" | "canvas_layout">>) =>
    api<Dashboard>(`/dashboards/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  remove: (id: string) => api<void>(`/dashboards/${id}`, { method: "DELETE" }),
  duplicate: (id: string) => api<Dashboard>(`/dashboards/${id}/duplicate`, { method: "POST" }),
  starter: (datasetId: string) => api<Dashboard>(`/datasets/${datasetId}/starter-dashboard`, { method: "POST" }),
  addChart: (id: string, body: { spec: ChartSpec; kind: ChartKind; note?: string | null }) =>
    api<ChartRecord>(`/dashboards/${id}/charts`, { method: "POST", body: JSON.stringify(body) }),
  updateChart: (chartId: string, body: { spec?: ChartSpec; kind?: ChartKind; note?: string | null }) =>
    api<ChartRecord>(`/charts/${chartId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteChart: (chartId: string) => api<void>(`/charts/${chartId}`, { method: "DELETE" }),
  reorder: (id: string, chartIds: string[]) =>
    api<ChartRecord[]>(`/dashboards/${id}/order`, { method: "PUT", body: JSON.stringify({ chart_ids: chartIds }) }),
  share: (id: string) => api<{ share_token: string | null }>(`/dashboards/${id}/share`, { method: "POST" }),
  unshare: (id: string) => api<{ share_token: string | null }>(`/dashboards/${id}/share`, { method: "DELETE" }),
  preview: (body: { spec: ChartSpec; date_from?: string | null; date_to?: string | null }) =>
    api<{ rows: ResultRow[]; insight: Insight }>("/charts/preview", { method: "POST", body: JSON.stringify(body) }),
};
