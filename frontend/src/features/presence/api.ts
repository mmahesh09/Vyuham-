"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";

/** Mirrors backend/app/schemas.py PresenceStatus. "offline" is how teammates see "appear_offline". */
export type PresenceStatus = "available" | "away" | "busy" | "dnd" | "appear_offline" | "out_of_office" | "on_leave";
export type LeaveType = "sick" | "casual" | "paid";

export type Leave = {
  id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  backup_user_id: string | null;
  backup_name: string | null;
  note: string | null;
  status: "active" | "ended" | "cancelled";
  created_at: string;
};

export type Presence = { status: PresenceStatus; message: string | null; leave: Leave | null; updated_at: string | null };

export type LeaveInput = {
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  backup_user_id?: string | null;
  backup_name?: string | null;
  note?: string | null;
};

export const presenceKeys = { me: ["presence"] as const, leaves: ["presence", "leaves"] as const };

export function usePresence() {
  return useQuery({ queryKey: presenceKeys.me, queryFn: () => api<Presence>("/me/presence") });
}

export function useLeaves() {
  return useQuery({ queryKey: presenceKeys.leaves, queryFn: () => api<Leave[]>("/me/leaves") });
}

export function useSetPresence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { status: PresenceStatus; message?: string | null; leave?: LeaveInput }) =>
      api<Presence>("/me/presence", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: (presence) => {
      queryClient.setQueryData(presenceKeys.me, presence);
      queryClient.invalidateQueries({ queryKey: presenceKeys.leaves });
      queryClient.invalidateQueries({ queryKey: ["workspace"] }); // team tree + activity
    },
  });
}
