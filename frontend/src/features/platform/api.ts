"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";

/* ---------------- shared ---------------- */

export type Project = { id: string; name: string; description: string | null; created_at: string };

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/sql/projects") });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string }) => api<Project>("/sql/projects", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useAiStatus() {
  return useQuery({ queryKey: ["ai", "status"], queryFn: () => api<{ enabled: boolean }>("/ai/status"), staleTime: 5 * 60_000 });
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

export function formatMs(ms: number | null | undefined) {
  if (ms == null) return "–";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

export function formatBytes(b: number | null | undefined) {
  if (!b) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/* ---------------- pipelines ---------------- */

export type StepType = "schedule" | "source" | "sql" | "dedupe" | "validate" | "destination";
export type Check = {
  type: "not_null" | "unique" | "accepted_values" | "references" | "row_count_min" | "expression";
  column?: string;
  values?: string[];
  ref_table?: string;
  ref_column?: string;
  min?: number;
  sql?: string;
};
export type StepConfig = {
  type?: StepType;
  name?: string;
  dataset_id?: string;
  columns?: string[];
  sql?: string;
  python?: string;
  keys?: string[];
  order_by?: string;
  checks?: Check[];
  on_fail?: "fail" | "warn" | "drop";
  target_name?: string;
  layer?: "bronze" | "silver" | "gold";
  mode?: "replace" | "append" | "incremental";
  watermark?: string;
};
export type PNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: { label: string; detail: string; kind: "trigger" | "agent" | "integration" | "review" | "delivery"; tool?: string; config?: StepConfig; explanation?: string };
};
export type PEdge = { id: string; source: string; target: string; type?: string };
export type PGraph = { nodes: PNode[]; edges: PEdge[] };

export type Pipeline = {
  id: string;
  name: string;
  description: string | null;
  graph: PGraph;
  schedule: "manual" | "hourly" | "daily";
  hour: number;
  enabled: boolean;
  project_id: string | null;
  generated_by_ai: boolean;
  approved_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
  problems: string[];
  needs_approval: boolean;
};
export type StepRun = {
  status: "pending" | "running" | "success" | "failed" | "skipped";
  rows?: number | null;
  duration_ms?: number;
  error?: string;
  logs?: string[];
  reused?: boolean;
  checks?: { check: string; failed_rows: number; passed: boolean }[];
};
export type PipelineRun = {
  id: string;
  pipeline_id: string;
  trigger: string;
  status: "queued" | "running" | "success" | "failed";
  steps: Record<string, StepRun>;
  only_steps: string[] | null;
  retry_of: string | null;
  error: string | null;
  rows_written: number | null;
  duration_ms: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};
export type Suggestion = { kind: string; severity: "low" | "medium" | "high"; node_id: string | null; title: string; detail: string };
export type Preview = { columns: string[]; rows: Record<string, unknown>[]; row_count: number; elapsed_ms?: number };
export type Plan = {
  action_id: string;
  name: string;
  understanding: string;
  feasible: boolean;
  missing: string[];
  design: string;
  incremental: string;
  schedule: "manual" | "hourly" | "daily";
  hour: number;
  graph: PGraph;
  problems: string[];
  step_problems: Record<string, string>;
  used_tables: string[];
};
export type Debug = {
  action_id: string;
  summary: string;
  failed_step: string;
  cause: string;
  fix: string;
  node_id: string;
  corrected_sql: string;
  graph: PGraph | null;
  valid: boolean | null;
  check_problems: Record<string, string>;
};
export type PipelineBody = {
  name: string;
  description?: string | null;
  graph: PGraph;
  schedule: Pipeline["schedule"];
  hour: number;
  enabled: boolean;
  project_id?: string | null;
  ai_action_id?: string | null;
};

export const pipelineKeys = {
  all: ["pipelines"] as const,
  one: (id: string) => ["pipelines", id] as const,
  runs: (id: string) => ["pipelines", id, "runs"] as const,
  run: (id: string, rid: string) => ["pipelines", id, "runs", rid] as const,
};

export const usePipelines = () => useQuery({ queryKey: pipelineKeys.all, queryFn: () => api<Pipeline[]>("/pipelines") });
export const usePipeline = (id: string) =>
  useQuery({ queryKey: pipelineKeys.one(id), queryFn: () => api<Pipeline>(`/pipelines/${id}`), enabled: !!id });
export const usePipelineRuns = (id: string) =>
  useQuery({
    queryKey: pipelineKeys.runs(id),
    queryFn: () => api<PipelineRun[]>(`/pipelines/${id}/runs`),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "queued" || r.status === "running") ? 1500 : false),
  });
export const useOptimize = (id: string, enabled: boolean) =>
  useQuery({ queryKey: ["pipelines", id, "optimize"], queryFn: () => api<{ suggestions: Suggestion[] }>(`/pipelines/${id}/optimize`), enabled });

export function useSavePipeline(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PipelineBody) =>
      id ? api<Pipeline>(`/pipelines/${id}`, { method: "PUT", body: JSON.stringify(body) }) : api<Pipeline>("/pipelines", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (p) => {
      qc.setQueryData(pipelineKeys.one(p.id), p);
      qc.invalidateQueries({ queryKey: pipelineKeys.all });
      qc.invalidateQueries({ queryKey: ["pipelines", p.id, "optimize"] });
    },
  });
}

export function usePipelineAction(id: string) {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: pipelineKeys.one(id) });
    qc.invalidateQueries({ queryKey: pipelineKeys.runs(id) });
    qc.invalidateQueries({ queryKey: pipelineKeys.all });
  };
  return {
    approve: useMutation({ mutationFn: () => api<Pipeline>(`/pipelines/${id}/approve`, { method: "POST" }), onSuccess: done }),
    run: useMutation({
      mutationFn: (body: { only_steps?: string[]; retry_of?: string; confirm_overwrite?: boolean }) =>
        api<PipelineRun>(`/pipelines/${id}/runs`, { method: "POST", body: JSON.stringify(body) }),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: () => api<void>(`/pipelines/${id}`, { method: "DELETE" }), onSuccess: done }),
    debug: useMutation({ mutationFn: (rid: string) => api<Debug>(`/pipelines/${id}/runs/${rid}/debug`, { method: "POST" }) }),
  };
}

export const previewStep = (graph: PGraph, node_id: string) =>
  api<Preview>("/pipelines/preview", { method: "POST", body: JSON.stringify({ graph, node_id }) });
export const checkGraph = (graph: PGraph) =>
  api<{ problems: string[]; steps: Record<string, string> }>("/pipelines/check", { method: "POST", body: JSON.stringify({ graph }) });
export const planPipeline = (request: string) => api<Plan>("/pipelines/ai/plan", { method: "POST", body: JSON.stringify({ request }) });

/* ---------------- dynamic tables ---------------- */

export type Refresh = {
  id: string;
  trigger: string;
  mode: "full" | "incremental";
  status: "queued" | "running" | "success" | "failed";
  attempt: number;
  rows: number | null;
  rows_added: number | null;
  duration_ms: number | null;
  error: string | null;
  schema_change: { added: string[]; removed: string[]; retyped: string[] } | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};
export type DynamicTable = {
  id: string;
  dataset_id: string;
  name: string;
  sql: string;
  params: { name: string; type: "text" | "number" | "date"; value: string }[];
  upstream: { id: string; name: string; layer: string | null }[];
  interval_minutes: number | null;
  on_upstream_change: boolean;
  refresh_mode: "full" | "incremental";
  refresh_mode_note: string;
  watermark_column: string | null;
  paused: boolean;
  status: "pending" | "refreshing" | "ok" | "failed" | "paused";
  last_refresh_at: string | null;
  next_refresh_at: string | null;
  last_error: string | null;
  failures: number;
  row_count: number;
  layer: string | null;
  project_id: string | null;
  last_refresh: Refresh | null;
  created_at: string;
};
export type DynamicBody = {
  name: string;
  sql: string;
  layer?: "bronze" | "silver" | "gold" | null;
  description?: string | null;
  interval_minutes?: number | null;
  on_upstream_change?: boolean;
  refresh_mode?: "full" | "incremental";
  watermark_column?: string | null;
  project_id?: string | null;
};

const busy = (t?: DynamicTable[] | DynamicTable) =>
  (Array.isArray(t) ? t : t ? [t] : []).some((x) => x.status === "pending" || x.status === "refreshing" || x.last_refresh?.status === "queued" || x.last_refresh?.status === "running");

export const useDynamicTables = () =>
  useQuery({ queryKey: ["dynamic"], queryFn: () => api<DynamicTable[]>("/dynamic-tables"), refetchInterval: (q) => (busy(q.state.data) ? 2000 : 30_000) });
export const useDynamicTable = (id: string) =>
  useQuery({ queryKey: ["dynamic", id], queryFn: () => api<DynamicTable>(`/dynamic-tables/${id}`), refetchInterval: (q) => (busy(q.state.data) ? 1500 : 30_000) });
export const useRefreshes = (id: string) =>
  useQuery({ queryKey: ["dynamic", id, "refreshes"], queryFn: () => api<Refresh[]>(`/dynamic-tables/${id}/refreshes`), refetchInterval: 4000 });
export const useDynamicGraph = () =>
  useQuery({
    queryKey: ["dynamic", "graph"],
    queryFn: () => api<{ nodes: { id: string; name: string; kind: "dynamic" | "dataset"; table_id: string | null; status: string | null; layer: string | null }[]; edges: { from: string; to: string }[] }>("/dynamic-tables/graph"),
  });
export const useDynamicPreview = (id: string, enabled: boolean) =>
  useQuery({ queryKey: ["dynamic", id, "preview"], queryFn: () => api<Preview>(`/dynamic-tables/${id}/preview`), enabled });
export const validateDynamic = (sql: string, table_id?: string) =>
  api<{ ok: boolean; error: string | null; dependencies: { id: string; name: string; layer: string | null }[] }>("/dynamic-tables/validate", {
    method: "POST",
    body: JSON.stringify({ sql, table_id }),
  });

export function useDynamicMutations(id?: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["dynamic"] });
  return {
    save: useMutation({
      mutationFn: (body: DynamicBody) =>
        id ? api<DynamicTable>(`/dynamic-tables/${id}`, { method: "PUT", body: JSON.stringify(body) }) : api<DynamicTable>("/dynamic-tables", { method: "POST", body: JSON.stringify(body) }),
      onSuccess: done,
    }),
    patch: useMutation({
      mutationFn: (body: { interval_minutes?: number | null; clear_interval?: boolean; on_upstream_change?: boolean; paused?: boolean }) =>
        api<DynamicTable>(`/dynamic-tables/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
      onSuccess: done,
    }),
    refresh: useMutation({ mutationFn: (full: boolean) => api<Refresh>(`/dynamic-tables/${id}/refresh`, { method: "POST", body: JSON.stringify({ full }) }), onSuccess: done }),
    remove: useMutation({ mutationFn: (keep: boolean) => api<void>(`/dynamic-tables/${id}?keep_data=${keep}`, { method: "DELETE" }), onSuccess: done }),
  };
}

/* ---------------- usage ---------------- */

export type CostSettings = {
  currency: string;
  compute_per_hour: number;
  storage_per_gb_month: number;
  scan_per_gb: number;
  ai_input_per_mtok: number;
  ai_output_per_mtok: number;
  monthly_budget: number | null;
  alert_threshold_pct: number;
  updated_at?: string | null;
};
export type RankItem = { kind: "query" | "pipeline" | "dynamic_table"; id: string; name: string; total_ms: number; runs: number; avg_ms: number; opportunity: string | null; estimated_cost: number };
export type UsageSummary = {
  period_days: number;
  billed: { available: false; reason: string };
  measured: {
    queries: number; query_ms: number; pipeline_runs: number; pipeline_ms: number; refreshes: number; refresh_ms: number;
    scanned_bytes_upper_bound: number; storage_bytes: number; datasets: number; ai_requests: number; ai_input_tokens: number;
    ai_output_tokens: number; ai_requests_without_usage: number; failed_ms: number; notebooks: { tracked: boolean; reason: string };
  };
  estimated: { rates_set: boolean; currency: string; total: number; compute: number; scan: number; storage: number; ai: number; failed_work: number };
  budget: { monthly_budget: number; month_to_date: number; projected: number; projected_pct: number; threshold_pct: number; status: "ok" | "warn" | "over" } | null;
  trend: { day: string; query_ms: number; pipeline_ms: number; refresh_ms: number; queries: number; ai_tokens: number; errors: number }[];
  by_user: { user_id: string; name: string; queries: number; query_ms: number; pipeline_ms: number; ai_tokens: number; scanned_bytes: number }[];
  by_project: { project_id: string | null; name: string; query_ms: number; pipeline_ms: number; refresh_ms: number; total_ms: number }[];
  by_query: { fingerprint: string; name: string | null; project: string | null; kind: string; runs: number; total_ms: number; avg_ms: number; max_ms: number; rows: number; scanned_bytes: number; errors: number; users: number; last_at: string | null }[];
  by_pipeline: { pipeline_id: string; name: string; runs: number; total_ms: number; failed: number; rows_written: number; max_ms: number }[];
  by_dynamic_table: { table_id: string; name: string; refreshes: number; total_ms: number; failed: number; incremental: number; max_ms: number }[];
  by_dataset: { dataset_id: string; name: string; layer: string | null; storage_bytes: number; rows: number; reads: number; scanned_bytes: number; last_read_at: string | null; storage_cost_month: number }[];
  ranking: RankItem[];
  long_running: { kind: string; name: string; duration_ms: number; status: string; at: string; user: string | null }[];
  repeated_expensive: UsageSummary["by_query"];
  idle: { kind: string; id: string; name: string; storage_bytes: number; detail: string; monthly_cost: number }[];
  savings: { what: string; measured_ms: number; estimated: number; assumes: string }[];
  suggestions: string[];
};

export const useUsage = (days: number) => useQuery({ queryKey: ["usage", days], queryFn: () => api<UsageSummary>(`/usage/summary?days=${days}`) });
export const useCostSettings = () => useQuery({ queryKey: ["usage", "settings"], queryFn: () => api<CostSettings>("/usage/settings") });
export function useSaveCostSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CostSettings) => api<CostSettings>("/usage/settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usage"] }),
  });
}

/* ---------------- governance ---------------- */

export type GovLabel = "public" | "internal" | "confidential" | "restricted";
export type PiiType = "email" | "phone" | "person_name" | "address" | "financial" | "government_id" | "sensitive";
export type MaskMethod = "partial" | "hash" | "redact" | "full" | "hide";
export type Classification = {
  id: string; dataset_id: string; dataset: string; layer: string | null; column: string; column_type: string | null; label: GovLabel;
  pii_type: PiiType | null; source: "scanner" | "manual"; confidence: number | null; matched: number | null; sampled: number | null;
  status: "active" | "dismissed"; updated_at: string; masked_for: Record<"editor" | "viewer" | "public", string | null>;
};
export type Policy = { id: string; kind: "masking" | "classification" | "retention"; name: string; rules: Record<string, unknown>; enabled: boolean; created_at: string; updated_at: string };
export type GovOverview = {
  datasets: number; datasets_with_sensitive_data: number; classified_columns: number; by_label: Record<GovLabel, number>;
  by_type: Record<PiiType, number>; policies: { masking: number; total: number }; grants: number; members_by_role: Record<string, number>;
  unprotected: { dataset_id: string; dataset: string; column: string; label: GovLabel; pii_type: PiiType | null; visible_to: string[] }[];
  never_scanned: { id: string; name: string }[]; audit_events_7d: number; exports_7d: number; enforcement: string;
};
export type AccessReview = {
  members: { user_id: string; name: string; email: string | null; role: string }[];
  grants: { id: string; dataset_id: string; dataset: string; column: string; role: string; access: string; created_at: string }[];
  matrix: { dataset_id: string; dataset: string; layer: string | null; roles: Record<string, { access: "full" | "partial" | "none"; masked_columns: number; hidden_columns: number }> }[];
  roles: Record<string, string>;
};
export type AuditEvent = { type: "change" | "export" | "access"; action: string; user: string; user_id: string | null; target_type: string; target_id: string | null; target: string | null; detail: Record<string, unknown>; at: string };

export const useGovOverview = () => useQuery({ queryKey: ["gov", "overview"], queryFn: () => api<GovOverview>("/governance/overview") });
export const useClassifications = (dismissed: boolean) =>
  useQuery({ queryKey: ["gov", "classes", dismissed], queryFn: () => api<Classification[]>(`/governance/classifications?include_dismissed=${dismissed}`) });
export const usePolicies = () => useQuery({ queryKey: ["gov", "policies"], queryFn: () => api<Policy[]>("/governance/policies") });
export const useAccessReview = () => useQuery({ queryKey: ["gov", "access"], queryFn: () => api<AccessReview>("/governance/access") });
export const useAudit = (group: string, days: number, enabled: boolean) =>
  useQuery({ queryKey: ["gov", "audit", group, days], queryFn: () => api<{ events: AuditEvent[] }>(`/governance/audit?group=${group}&days=${days}`), enabled });

export function useGovMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["gov"] });
  return {
    scan: useMutation({ mutationFn: () => api<{ datasets: number; new: number; updated: number; default_policies_created: boolean }>("/governance/scan", { method: "POST", body: "{}" }), onSuccess: done }),
    classify: useMutation({
      mutationFn: (b: { dataset_id: string; column: string; label: GovLabel; pii_type: PiiType | null; status: "active" | "dismissed" }) =>
        api("/governance/classifications", { method: "PUT", body: JSON.stringify(b) }),
      onSuccess: done,
    }),
    savePolicy: useMutation({
      mutationFn: (p: { id?: string; kind: Policy["kind"]; name: string; rules: Record<string, unknown>; enabled: boolean }) =>
        p.id ? api<Policy>(`/governance/policies/${p.id}`, { method: "PUT", body: JSON.stringify(p) }) : api<Policy>("/governance/policies", { method: "POST", body: JSON.stringify(p) }),
      onSuccess: done,
    }),
    deletePolicy: useMutation({ mutationFn: (id: string) => api(`/governance/policies/${id}`, { method: "DELETE" }), onSuccess: done }),
    grant: useMutation({
      mutationFn: (b: { dataset_id: string; column: string; role: "editor" | "viewer" | "public"; access: "none" | "masked" | "read" | "default" }) =>
        api("/governance/access", { method: "PUT", body: JSON.stringify(b) }),
      onSuccess: done,
    }),
  };
}

export const previewAs = (dataset_id: string, role: string) =>
  api<{ hidden: boolean; columns: string[]; rows: Record<string, unknown>[]; masked?: Record<string, string>; error?: string }>(`/governance/preview/${dataset_id}?role=${role}`);

/* ---------------- AI (SQL Workbench) ---------------- */

export type SqlAiAction = "write" | "explain" | "fix" | "optimize" | "python";
export type SqlAiResult = { action_id: string; sql: string | null; python: string | null; explanation: string; changes: string[]; valid: boolean | null; check_error: string | null };
export const askSqlAi = (body: { action: SqlAiAction; question?: string; sql?: string; error?: string; params?: unknown[] }) =>
  api<SqlAiResult>("/ai/sql", { method: "POST", body: JSON.stringify(body) });
export const setAiOutcome = (id: string, outcome: "applied" | "rejected") =>
  api(`/ai/actions/${id}/outcome`, { method: "POST", body: JSON.stringify({ outcome }) }).catch(() => undefined);
