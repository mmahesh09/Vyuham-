"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ChartSpec } from "@/features/charts/chart-spec";

import { dashboardsApi, type ChartKind, type ChartRecord, type Dashboard, type DashboardSource, type ViewQuery } from "./api";

export const dashboardKeys = {
  all: ["dashboards"] as const,
  detail: (id: string) => ["dashboards", id] as const,
};

export function useDashboards() {
  return useQuery({ queryKey: dashboardKeys.all, queryFn: dashboardsApi.list });
}

export function useDashboardMeta(source: DashboardSource) {
  return useQuery({ queryKey: source.key, queryFn: source.get });
}

/** Keeps the previous numbers on screen while new filters load, so nothing flashes. */
export function useDashboardView(source: DashboardSource, q: ViewQuery, chartIds: string) {
  return useQuery({
    queryKey: [...source.key, "view", q, chartIds],
    queryFn: () => source.view(q),
    placeholderData: keepPreviousData,
  });
}

export function useFilterValues(source: DashboardSource, column: string) {
  return useQuery({ queryKey: [...source.key, "values", column], queryFn: () => source.values(column), staleTime: 60_000 });
}

/** Mutations on one dashboard. Each keeps the cached dashboard in step so the screen updates at once. */
export function useDashboardMutations(id: string) {
  const qc = useQueryClient();
  const key = dashboardKeys.detail(id);
  const setDashboard = (d: Dashboard) => qc.setQueryData(key, d);
  const patchCharts = (fn: (charts: ChartRecord[]) => ChartRecord[]) =>
    qc.setQueryData<Dashboard>(key, (old) => (old ? { ...old, charts: fn(old.charts) } : old));
  const refreshList = () => qc.invalidateQueries({ queryKey: dashboardKeys.all, exact: true });
  const refreshView = () => qc.invalidateQueries({ queryKey: [...key, "view"] });

  return {
    update: useMutation({
      mutationFn: (body: Parameters<typeof dashboardsApi.update>[1]) => dashboardsApi.update(id, body),
      onSuccess: (d) => (setDashboard(d), refreshList(), refreshView()),
    }),
    addChart: useMutation({
      mutationFn: (body: { spec: ChartSpec; kind: ChartKind; note?: string | null }) => dashboardsApi.addChart(id, body),
      onSuccess: () => (qc.invalidateQueries({ queryKey: key }), refreshList()),
      // (the dashboard refetch changes the chart ids, which refetches the view)
    }),
    updateChart: useMutation({
      mutationFn: ({ chartId, ...body }: { chartId: string; spec?: ChartSpec; kind?: ChartKind; note?: string | null }) =>
        dashboardsApi.updateChart(chartId, body),
      onSuccess: (c) => (patchCharts((charts) => charts.map((x) => (x.id === c.id ? c : x))), refreshView()),
    }),
    deleteChart: useMutation({
      mutationFn: (chartId: string) => dashboardsApi.deleteChart(chartId),
      onSuccess: (_, chartId) => (patchCharts((charts) => charts.filter((c) => c.id !== chartId)), refreshList()),
    }),
    reorder: useMutation({
      mutationFn: (chartIds: string[]) => dashboardsApi.reorder(id, chartIds),
      // Optimistic: move cards immediately, roll back if the server refuses.
      onMutate: async (chartIds) => {
        await qc.cancelQueries({ queryKey: key, exact: true });
        const before = qc.getQueryData<Dashboard>(key);
        patchCharts((charts) => {
          const byId = new Map(charts.map((c) => [c.id, c]));
          const moved = chartIds.flatMap((cid) => (byId.has(cid) ? [byId.get(cid)!] : []));
          return [...moved, ...charts.filter((c) => !chartIds.includes(c.id))].map((c, n) => ({ ...c, position: n }));
        });
        return { before };
      },
      onError: (_e, _v, ctx) => ctx?.before && setDashboard(ctx.before),
    }),
    share: useMutation({
      mutationFn: () => dashboardsApi.share(id),
      onSuccess: ({ share_token }) => (qc.setQueryData<Dashboard>(key, (o) => (o ? { ...o, share_token } : o)), refreshList()),
    }),
    unshare: useMutation({
      mutationFn: () => dashboardsApi.unshare(id),
      onSuccess: () => (qc.setQueryData<Dashboard>(key, (o) => (o ? { ...o, share_token: null } : o)), refreshList()),
    }),
  };
}

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: dashboardsApi.create,
    onSuccess: (d) => (qc.setQueryData(dashboardKeys.detail(d.id), d), qc.invalidateQueries({ queryKey: dashboardKeys.all, exact: true })),
  });
}

export function useStarterDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: dashboardsApi.starter,
    onSuccess: (d) => (qc.setQueryData(dashboardKeys.detail(d.id), d), qc.invalidateQueries({ queryKey: dashboardKeys.all, exact: true })),
  });
}

export function useDuplicateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: dashboardsApi.duplicate,
    onSuccess: (d) => (qc.setQueryData(dashboardKeys.detail(d.id), d), qc.invalidateQueries({ queryKey: dashboardKeys.all, exact: true })),
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: dashboardsApi.remove,
    onSuccess: (_, id) => {
      qc.setQueryData<{ id: string }[]>(dashboardKeys.all, (old) => old?.filter((d) => d.id !== id));
      qc.removeQueries({ queryKey: dashboardKeys.detail(id) });
    },
  });
}
