"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";

import type { ColumnType } from "./types";

/** Mirrors backend/app/schemas.py DatasetOut. */
export type Dataset = {
  id: string;
  name: string;
  source_filename: string;
  source_kind: "csv" | "xlsx";
  sheet: string | null;
  row_count: number;
  columns: DatasetColumn[];
  file_size: number;
  created_at: string;
  updated_at: string | null;
};

export type DatasetColumn = { name: string; type: ColumnType; empty_ratio: number; examples: string[] };

/** One row from the backend, values already JSON (numbers, ISO dates, strings, null). */
export type DatasetRow = Record<string, string | number | boolean | null>;
export type RowFilter = { field: string; op: string; value?: unknown };
export type RowsQuery = { page: number; size: number; sort?: string; direction?: "asc" | "desc"; q?: string; filters?: RowFilter[] };
export type RowsPage = { rows: DatasetRow[]; total: number; page: number; size: number };

export const datasetKeys = {
  all: ["datasets"] as const,
  detail: (id: string) => ["datasets", id] as const,
  rows: (id: string, q: RowsQuery) => ["datasets", id, "rows", q] as const,
  values: (id: string, column: string) => ["datasets", id, "values", column] as const,
};

export function useDatasets() {
  return useQuery({ queryKey: datasetKeys.all, queryFn: () => api<Dataset[]>("/datasets") });
}

/** Sends the original file; the server re-reads it, types the columns and stores Parquet. */
export function useUploadDataset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, sheet }: { file: File; sheet?: string | null }) => {
      const body = new FormData();
      body.append("file", file);
      if (sheet) body.append("sheet", sheet);
      return api<Dataset>("/datasets", { method: "POST", body });
    },
    onSuccess: (dataset) => {
      queryClient.setQueryData<Dataset[]>(datasetKeys.all, (old) => [dataset, ...(old ?? []).filter((d) => d.id !== dataset.id)]);
    },
  });
}

export function useDataset(id: string) {
  return useQuery({ queryKey: datasetKeys.detail(id), queryFn: () => api<Dataset>(`/datasets/${id}`) });
}

/** One page of rows for the grid; keeps the previous page on screen while the next loads. */
export function useDatasetRows(id: string, q: RowsQuery) {
  return useQuery({
    queryKey: datasetKeys.rows(id, q),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(q.page), size: String(q.size) });
      if (q.sort) params.set("sort", q.sort);
      if (q.direction) params.set("direction", q.direction);
      if (q.q?.trim()) params.set("q", q.q.trim());
      if (q.filters?.length) params.set("filters", JSON.stringify(q.filters));
      return api<RowsPage>(`/datasets/${id}/rows?${params}`);
    },
    placeholderData: keepPreviousData,
  });
}

export function useColumnValues(id: string | undefined, column: string | undefined) {
  return useQuery({
    queryKey: datasetKeys.values(id ?? "", column ?? ""),
    queryFn: () => api<string[]>(`/datasets/${id}/values/${encodeURIComponent(column!)}`),
    enabled: Boolean(id && column),
    staleTime: 60_000,
  });
}

function useDatasetMutationSuccess() {
  const queryClient = useQueryClient();
  return (dataset: Dataset) => {
    queryClient.setQueryData(datasetKeys.detail(dataset.id), dataset);
    queryClient.setQueryData<Dataset[]>(datasetKeys.all, (old) => old?.map((d) => (d.id === dataset.id ? dataset : d)));
    // Rows and values depend on types and content.
    queryClient.invalidateQueries({ queryKey: [...datasetKeys.detail(dataset.id), "rows"] });
    queryClient.invalidateQueries({ queryKey: [...datasetKeys.detail(dataset.id), "values"] });
  };
}

export function useUpdateDataset(id: string) {
  const onSuccess = useDatasetMutationSuccess();
  return useMutation({
    mutationFn: (body: { name?: string; column_types?: Record<string, ColumnType> }) =>
      api<Dataset>(`/datasets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess,
  });
}

export function useReplaceDatasetFile(id: string) {
  const onSuccess = useDatasetMutationSuccess();
  return useMutation({
    mutationFn: ({ file, sheet }: { file: File; sheet?: string | null }) => {
      const body = new FormData();
      body.append("file", file);
      if (sheet) body.append("sheet", sheet);
      return api<Dataset>(`/datasets/${id}/file`, { method: "PUT", body });
    },
    onSuccess,
  });
}

export function useDeleteDataset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/datasets/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Dataset[]>(datasetKeys.all, (old) => old?.filter((d) => d.id !== id));
      queryClient.removeQueries({ queryKey: datasetKeys.detail(id) });
    },
  });
}
