"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { datasetKeys, type Dataset } from "@/features/datasets/api";

/** Mirrors backend/app/schemas.py. The password is write-only: it is never returned. */
export type ConnectionKind = "postgres" | "mysql";
export type SslMode = "require" | "verify-full" | "disable";
export type Refresh = "manual" | "hourly" | "daily";

export type ConnectionFields = {
  kind: ConnectionKind;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl_mode: SslMode;
};

export type Connection = ConnectionFields & {
  id: string;
  name: string;
  status: "ok" | "error";
  last_error: string | null;
  last_checked_at: string | null;
  created_at: string;
  dataset_count: number;
};

export type DbTable = { key: string; schema: string | null; name: string; kind: "table" | "view"; rows: number | null };
export type TestResult = { ok: boolean; message: string; table_count: number | null };
export type TablePreview = { columns: string[]; rows: (string | number | boolean | null)[][] };

export const KIND_LABEL: Record<ConnectionKind, string> = { postgres: "PostgreSQL", mysql: "MySQL" };
export const DEFAULT_PORT: Record<ConnectionKind, number> = { postgres: 5432, mysql: 3306 };

export const connectionKeys = {
  all: ["connections"] as const,
  settings: ["connections", "settings"] as const,
  tables: (id: string) => ["connections", id, "tables"] as const,
  preview: (id: string, table: string) => ["connections", id, "preview", table] as const,
};

/** Editors and owners only: the API doesn't show database details to viewers. */
export function useConnections(enabled = true) {
  return useQuery({ queryKey: connectionKeys.all, queryFn: () => api<Connection[]>("/connections"), enabled });
}

export function useConnectionSettings() {
  return useQuery({
    queryKey: connectionKeys.settings,
    queryFn: () => api<{ egress_ip: string | null }>("/connections/settings"),
    staleTime: Infinity,
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (body: ConnectionFields & { password: string; connection_id?: string }) =>
      api<TestResult>("/connections/test", { method: "POST", body: JSON.stringify(body) }),
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ConnectionFields & { name: string; password: string }) =>
      api<Connection>("/connections", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionKeys.all }),
  });
}

export function useUpdateConnection(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ConnectionFields> & { name?: string; password?: string }) =>
      api<Connection>(`/connections/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionKeys.all }),
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/connections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      queryClient.invalidateQueries({ queryKey: datasetKeys.all });
    },
  });
}

export function useConnectionTables(id: string | null) {
  return useQuery({
    queryKey: connectionKeys.tables(id ?? ""),
    queryFn: () => api<DbTable[]>(`/connections/${id}/tables`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useTablePreview(id: string | null, table: string | null) {
  return useQuery({
    queryKey: connectionKeys.preview(id ?? "", table ?? ""),
    queryFn: () => api<TablePreview>(`/connections/${id}/preview?table=${encodeURIComponent(table!)}`),
    enabled: Boolean(id && table),
    staleTime: 60_000,
  });
}

export type SyncRequest = { tables: string[]; refresh: Refresh } | { query: string; name: string; refresh: Refresh };

export function useCreateSyncedDatasets(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SyncRequest) =>
      api<{ datasets: Dataset[]; errors: Record<string, string> }>(`/connections/${connectionId}/datasets`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: datasetKeys.all });
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    },
  });
}

/** "Refresh now": the sync runs in the background, so poll the dataset until it reports back. */
export function useSyncDataset(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const before = await api<Dataset>(`/datasets/${id}/sync`, { method: "POST" });
      const finished = before.sync_finished_at;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const now = await api<Dataset>(`/datasets/${id}`);
        if (now.sync_finished_at !== finished) return now; // succeeded or failed: `sync_error` says which
      }
      throw new Error("The refresh is taking a while. It will keep going in the background; check back in a few minutes.");
    },
    onSuccess: (dataset) => {
      queryClient.setQueryData(datasetKeys.detail(id), dataset);
      queryClient.invalidateQueries({ queryKey: datasetKeys.all });
      queryClient.invalidateQueries({ queryKey: [...datasetKeys.detail(id), "rows"] });
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    },
  });
}

/** Fill the form from a pasted URL like postgres://user:pass@host:5432/db?sslmode=require. */
export function parseConnectionUrl(raw: string): (Partial<ConnectionFields> & { password?: string }) | null {
  try {
    const url = new URL(raw.trim());
    const scheme = url.protocol.replace(":", "").split("+")[0];
    const kind: ConnectionKind | null = scheme.startsWith("postgres") ? "postgres" : scheme === "mysql" || scheme === "mariadb" ? "mysql" : null;
    if (!kind || !url.hostname) return null;
    const ssl = (url.searchParams.get("sslmode") ?? url.searchParams.get("ssl-mode"))?.toLowerCase().replace("_", "-");
    return {
      kind,
      host: url.hostname,
      port: url.port ? Number(url.port) : DEFAULT_PORT[kind],
      database: decodeURIComponent(url.pathname.replace(/^\//, "")),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ...(ssl === "disable" || ssl === "disabled"
        ? { ssl_mode: "disable" as const }
        : ssl === "verify-full" || ssl === "verify-identity"
          ? { ssl_mode: "verify-full" as const }
          : {}),
    };
  } catch {
    return null;
  }
}
