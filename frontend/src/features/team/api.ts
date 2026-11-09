"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { profileKeys } from "@/features/profile/api";
import { api } from "@/lib/api/client";
import type { Role } from "@/lib/api/client";

/** Mirrors backend/app/routers/team.py. */
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  created_by: string | null;
  start_date: string | null;
  due_date: string | null;
  dataset_id: string | null;
  dashboard_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type TaskInput = Partial<Omit<Task, "id" | "created_by" | "position" | "created_at" | "updated_at" | "completed_at">> & { title?: string };

export type Invite = { token: string; role: Role; email: string | null; created_at: string; expires_at: string };
export type InviteInfo = { workspace_name: string; role: Role | ""; invited_by: string | null; valid: boolean; reason: string | null };
export type LeaveEvent = {
  id: string;
  user_id: string;
  user_name: string;
  leave_type: "sick" | "casual" | "paid";
  start_date: string;
  end_date: string;
  backup_name: string | null;
  status: string;
};

export const STATUS_LABEL: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", review: "Review", done: "Done" };
export const STATUSES: TaskStatus[] = ["todo", "in_progress", "review", "done"];
export const PRIORITY_LABEL: Record<TaskPriority, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

export const teamKeys = {
  tasks: ["tasks"] as const,
  invites: ["workspace", "invites"] as const,
  leaves: ["workspace", "leaves"] as const,
};

export function useTasks() {
  return useQuery({ queryKey: teamKeys.tasks, queryFn: () => api<Task[]>("/tasks") });
}

function useTaskCache() {
  const qc = useQueryClient();
  return {
    set: (fn: (tasks: Task[]) => Task[]) => qc.setQueryData<Task[]>(teamKeys.tasks, (old) => (old ? fn(old) : old)),
    refresh: () => {
      void qc.invalidateQueries({ queryKey: teamKeys.tasks });
      void qc.invalidateQueries({ queryKey: profileKeys.activity });
    },
    snapshot: () => qc.getQueryData<Task[]>(teamKeys.tasks),
    restore: (tasks: Task[] | undefined) => qc.setQueryData(teamKeys.tasks, tasks),
  };
}

export function useCreateTask() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: (body: TaskInput) => api<Task>("/tasks", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (t) => (cache.set((tasks) => [t, ...tasks]), cache.refresh()),
  });
}

export function useUpdateTask() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: ({ id, ...body }: TaskInput & { id: string }) => api<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    // Optimistic, so dragging on the timeline/calendar doesn't snap back while saving.
    onMutate: ({ id, ...body }) => {
      const before = cache.snapshot();
      cache.set((tasks) => tasks.map((t) => (t.id === id ? { ...t, ...body } : t)));
      return { before };
    },
    onError: (_e, _v, ctx) => cache.restore(ctx?.before),
    onSuccess: (t) => (cache.set((tasks) => tasks.map((x) => (x.id === t.id ? t : x))), cache.refresh()),
  });
}

export function useDeleteTask() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => cache.set((tasks) => tasks.filter((t) => t.id !== id)),
  });
}

/** One kanban column after a drop: these tasks, in this order, with this status. */
export function useOrderTasks() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: (body: { status: TaskStatus; task_ids: string[] }) =>
      api<Task[]>("/tasks/order", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: (updated) => {
      const byId = new Map(updated.map((t) => [t.id, t]));
      cache.set((tasks) => tasks.map((t) => byId.get(t.id) ?? t));
      cache.refresh();
    },
    onError: () => cache.refresh(),
  });
}

export function useWorkspaceLeaves() {
  return useQuery({ queryKey: teamKeys.leaves, queryFn: () => api<LeaveEvent[]>("/workspace/leaves") });
}

export function useInvites(enabled: boolean) {
  return useQuery({ queryKey: teamKeys.invites, queryFn: () => api<Invite[]>("/workspace/invites"), enabled });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { role: Role; email?: string | null }) => api<Invite>("/workspace/invites", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamKeys.invites }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api<void>(`/workspace/invites/${token}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamKeys.invites }),
  });
}

export function useChangeRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api<{ role: Role }>(`/workspace/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.members }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api<void>(`/workspace/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: profileKeys.members }), qc.invalidateQueries({ queryKey: teamKeys.tasks })),
  });
}
