"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";

import { datasetKeys, type Dataset, type Layer } from "./api";
import type { ColumnType } from "./types";

/** Mirrors backend/app/profile.py. */
export type ColumnStats = {
  name: string;
  type: ColumnType;
  filled: number;
  empty: number;
  empty_ratio: number;
  distinct: number;
  unique: boolean;
  min: string | number | null;
  max: string | number | null;
  mean?: number | null;
  std?: number | null;
  q1?: number | null;
  median?: number | null;
  q3?: number | null;
  histogram?: { from: number; to: number; count: number }[];
  timeline?: { unit: "day" | "week" | "month" | "year"; points: { at: string; count: number }[] };
  top?: { value: string; count: number }[];
  avg_length?: number;
  max_length?: number;
};
export type Profile = { rows: number; columns: ColumnStats[]; duplicate_rows: number; completeness: number };

export type RuleKind = "not_null" | "unique" | "accepted_values" | "range" | "regex" | "freshness" | "row_count" | "sql";
export type Rule = {
  id: string;
  kind: RuleKind;
  column: string | null;
  params: Record<string, unknown>;
  severity: "error" | "warn";
  enabled: boolean;
  description: string;
  created_at: string;
};
export type RuleResult = {
  rule_id: string;
  kind: RuleKind;
  column: string | null;
  severity: "error" | "warn";
  description: string;
  status: "pass" | "fail" | "error";
  failed: number;
  message: string;
  sample: Record<string, unknown>[];
};
export type QualityRun = {
  id: string;
  trigger: "manual" | "refresh" | "schedule";
  status: "pass" | "warn" | "fail" | "error";
  results: RuleResult[];
  row_count: number | null;
  created_at: string;
};
export type Suggestion = { kind: RuleKind; column: string | null; params: Record<string, unknown>; severity: "error" | "warn"; why: string; description: string };
export type QualityOverview = { rules: Rule[]; runs: QualityRun[]; suggestions: Suggestion[] };
export type RuleInput = { kind: RuleKind; column?: string | null; params?: Record<string, unknown>; severity?: "error" | "warn" };

export type LineageRef = { id: string; name: string; layer: Layer | null; source_kind: string };
export type Lineage = { upstream: LineageRef[]; downstream: LineageRef[] };

const keys = {
  profile: (id: string) => [...datasetKeys.detail(id), "profile"] as const,
  quality: (id: string) => [...datasetKeys.detail(id), "quality"] as const,
  lineage: (id: string) => [...datasetKeys.detail(id), "lineage"] as const,
};

export function useProfile(id: string, enabled = true) {
  return useQuery({ queryKey: keys.profile(id), queryFn: () => api<Profile>(`/datasets/${id}/profile`), enabled, staleTime: 5 * 60_000 });
}

export function useLineage(id: string) {
  return useQuery({ queryKey: keys.lineage(id), queryFn: () => api<Lineage>(`/datasets/${id}/lineage`) });
}

export function useQuality(id: string, enabled = true) {
  return useQuery({ queryKey: keys.quality(id), queryFn: () => api<QualityOverview>(`/datasets/${id}/quality`), enabled });
}

export function useQualityMutations(id: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.quality(id) });
  return {
    add: useMutation({
      mutationFn: (rule: RuleInput) => api<Rule>(`/datasets/${id}/quality/rules`, { method: "POST", body: JSON.stringify(rule) }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ ruleId, ...body }: { ruleId: string; severity?: "error" | "warn"; enabled?: boolean }) =>
        api<Rule>(`/datasets/${id}/quality/rules/${ruleId}`, { method: "PATCH", body: JSON.stringify(body) }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (ruleId: string) => api<void>(`/datasets/${id}/quality/rules/${ruleId}`, { method: "DELETE" }),
      onSuccess: refresh,
    }),
    run: useMutation({
      mutationFn: () => api<QualityRun>(`/datasets/${id}/quality/run`, { method: "POST" }),
      onSuccess: refresh,
    }),
  };
}

function useAddToList() {
  const qc = useQueryClient();
  return (dataset: Dataset) => {
    qc.setQueryData(datasetKeys.detail(dataset.id), dataset);
    qc.setQueryData<Dataset[]>(datasetKeys.all, (old) => [dataset, ...(old ?? []).filter((d) => d.id !== dataset.id)]);
  };
}

export type DerivedInput = {
  name: string;
  sql: string;
  params?: { name: string; type: "text" | "number" | "date"; value: string }[];
  layer?: Layer | null;
  description?: string | null;
  refresh?: "manual" | "hourly" | "daily";
};

/** SQL Lab "Save as dataset". */
export function useCreateDerived() {
  const add = useAddToList();
  return useMutation({ mutationFn: (body: DerivedInput) => api<Dataset>("/datasets/derived", { method: "POST", body: JSON.stringify(body) }), onSuccess: add });
}

export function useImportUrl() {
  const add = useAddToList();
  return useMutation({
    mutationFn: (body: { url: string; name?: string; layer?: Layer | null; refresh?: "manual" | "hourly" | "daily" }) =>
      api<Dataset>("/datasets/url", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: add,
  });
}

export const LAYERS: { value: Layer; label: string; hint: string }[] = [
  { value: "bronze", label: "Bronze", hint: "Raw data as it arrived" },
  { value: "silver", label: "Silver", hint: "Cleaned and checked" },
  { value: "gold", label: "Gold", hint: "Joined and summarised, ready for dashboards" },
];
