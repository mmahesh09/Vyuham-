"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { authKeys } from "@/features/auth/hooks";
import type { LeaveType, PresenceStatus } from "@/features/presence/api";
import { authClient } from "@/lib/auth-client";
import { api, ApiError, type User } from "@/lib/api/client";

/** Mirrors backend/app/schemas.py ProfileOut. */
export type Profile = {
  job_role: string;
  phone: string | null;
  timezone: string | null;
  work_start: string | null;
  work_end: string | null;
  /** PNG data URL */
  signature: string | null;
  dashboard_visibility: "team" | "anyone";
  notify_email: boolean;
  notify_weekly: boolean;
  updated_at: string | null;
};

export type ProfileInput = Omit<Profile, "updated_at">;

export type Member = {
  id: string;
  name: string;
  email: string;
  role: User["role"];
  job_role: string | null;
  joined_at: string;
  status: PresenceStatus | "offline";
  status_message: string | null;
  leave_type: LeaveType | null;
  leave_until: string | null;
  backup_name: string | null;
};

export type Activity = {
  id: string;
  kind: "dataset" | "member" | "profile" | "leave";
  title: string;
  detail: string;
  actor: string;
  at: string;
};

export const profileKeys = {
  profile: ["profile"] as const,
  members: ["workspace", "members"] as const,
  activity: ["workspace", "activity"] as const,
};

export function useProfile() {
  return useQuery({ queryKey: profileKeys.profile, queryFn: () => api<Profile>("/me/profile") });
}

export function useMembers() {
  return useQuery({ queryKey: profileKeys.members, queryFn: () => api<Member[]>("/workspace/members") });
}

export function useActivity() {
  return useQuery({ queryKey: profileKeys.activity, queryFn: () => api<Activity[]>("/workspace/activity"), refetchInterval: 60_000 });
}

/** Saves the name through Better Auth (it owns the user row) and everything else through the backend. */
export function useSaveProfile() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async ({ name, profile }: { name: string; profile: ProfileInput }) => {
      const me = queryClient.getQueryData<User>(authKeys.me);
      if (me && me.name !== name) {
        const { error } = await authClient.updateUser({ name });
        if (error) throw new ApiError(error.status, error.message ?? "Couldn't update your name");
      }
      return api<Profile>("/me/profile", { method: "PUT", body: JSON.stringify(profile) });
    },
    onSuccess: (profile, { name }) => {
      queryClient.setQueryData(profileKeys.profile, profile);
      queryClient.setQueryData<User>(authKeys.me, (old) => (old ? { ...old, name, job_role: profile.job_role } : old));
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      router.refresh(); // the sidebar shows the name from the server layout
    },
  });
}

export function useSendFeedback() {
  return useMutation({
    mutationFn: (body: { rating: number; comment?: string }) => api<{ ok: true }>("/feedback", { method: "POST", body: JSON.stringify(body) }),
  });
}
