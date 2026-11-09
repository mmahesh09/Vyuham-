"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Aggregation } from "@/features/charts/chart-spec";
import { api } from "@/lib/api/client";

/** Mirrors backend/app/routers/alerts.py. */
export type Channels = { inapp: boolean; emails: string[]; webhook: string | null };
export type Condition = "above" | "below" | "change_up" | "change_down";

export type Alert = {
  id: string;
  name: string;
  dataset_id: string | null;
  metric: { field: string; agg: Aggregation };
  filters: unknown[];
  date_field: string | null;
  window_days: number;
  condition: Condition;
  threshold: number;
  schedule: "hourly" | "daily" | "weekly";
  channels: Channels;
  enabled: boolean;
  state: "ok" | "triggered" | "error";
  last_value: number | null;
  last_checked_at: string | null;
  last_triggered_at: string | null;
  last_error: string | null;
  created_at: string;
};
export type AlertInput = Omit<Alert, "id" | "state" | "last_value" | "last_checked_at" | "last_triggered_at" | "last_error" | "created_at" | "dataset_id"> & {
  dataset_id: string;
};

export type Automation = {
  id: string;
  name: string;
  kind: "dashboard_digest";
  dashboard_id: string | null;
  schedule: "daily" | "weekly" | "monthly";
  hour: number;
  weekday: number;
  timezone: string;
  period_days: number;
  channels: Channels;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
};
export type AutomationInput = Omit<Automation, "id" | "last_run_at" | "last_status" | "created_at" | "dashboard_id"> & { dashboard_id: string };

export type AlertEvent = {
  id: string;
  alert_id: string | null;
  automation_id: string | null;
  title: string;
  body: string;
  value: number | null;
  delivery: Record<string, number | string>;
  created_at: string;
};
export type Notification = { id: string; title: string; body: string; link: string | null; kind: string; created_at: string; read_at: string | null };

export const CONDITION_LABEL: Record<Condition, string> = {
  above: "goes above",
  below: "drops below",
  change_up: "rises by at least (%)",
  change_down: "falls by at least (%)",
};

const keys = {
  alerts: ["alerts"] as const,
  automations: ["automations"] as const,
  history: ["alerts-history"] as const,
  notifications: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
};

export const useAlerts = () => useQuery({ queryKey: keys.alerts, queryFn: () => api<Alert[]>("/alerts") });
export const useAutomations = () => useQuery({ queryKey: keys.automations, queryFn: () => api<Automation[]>("/automations") });
export const useHistory = () => useQuery({ queryKey: keys.history, queryFn: () => api<AlertEvent[]>("/alerts-history") });
export const useNotifications = (enabled: boolean) =>
  useQuery({ queryKey: keys.notifications, queryFn: () => api<Notification[]>("/notifications"), enabled });
export const useUnreadCount = () =>
  useQuery({ queryKey: keys.unread, queryFn: () => api<{ count: number }>("/notifications/unread-count"), refetchInterval: 60_000 });

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    for (const k of Object.values(keys)) void qc.invalidateQueries({ queryKey: k });
  };
}

export function useSaveAlert() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: AlertInput & { id?: string }) =>
      api<Alert>(id ? `/alerts/${id}` : "/alerts", { method: id ? "PUT" : "POST", body: JSON.stringify(body) }),
    onSuccess: done,
  });
}
export function useDeleteAlert() {
  const done = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api<void>(`/alerts/${id}`, { method: "DELETE" }), onSuccess: done });
}
export function useCheckAlert() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: ({ id, test }: { id: string; test?: boolean }) => api<Alert>(`/alerts/${id}/check${test ? "?test=true" : ""}`, { method: "POST" }),
    onSuccess: done,
  });
}
export function useSaveAutomation() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: AutomationInput & { id?: string }) =>
      api<Automation>(id ? `/automations/${id}` : "/automations", { method: id ? "PUT" : "POST", body: JSON.stringify(body) }),
    onSuccess: done,
  });
}
export function useDeleteAutomation() {
  const done = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api<void>(`/automations/${id}`, { method: "DELETE" }), onSuccess: done });
}
export function useRunAutomation() {
  const done = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api<Automation>(`/automations/${id}/run`, { method: "POST" }), onSuccess: done });
}
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/notifications/read", { method: "POST" }),
    onSuccess: () => (qc.setQueryData(keys.unread, { count: 0 }), qc.invalidateQueries({ queryKey: keys.notifications })),
  });
}
