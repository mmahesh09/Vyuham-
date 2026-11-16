"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";

/** Mirrors backend/app/routers/support.py. Only public values: tokens never reach the browser. */
export type SupportConfig =
  | { enabled: false; help_center_url: string | null }
  | { enabled: true; base_url: string; website_token: string; help_center_url: string | null; can_list_conversations: boolean };

/** Signed by the backend from the session; the browser cannot choose who it is. */
export type SupportIdentity = { identifier: string; identifier_hash: string; name: string; email: string | null; workspace_id: string };

export type SupportConversation = {
  id: number;
  status: "open" | "resolved" | "pending" | "snoozed";
  created_at: number;
  last_activity_at: number;
  unread_count: number;
  last_message: { from: "you" | "support"; text: string } | null;
};

export const supportKeys = {
  config: ["support", "config"] as const,
  identity: ["support", "identity"] as const,
  conversations: ["support", "conversations"] as const,
};

export function useSupportConfig() {
  return useQuery({ queryKey: supportKeys.config, queryFn: () => api<SupportConfig>("/support/config"), staleTime: 10 * 60_000 });
}

export function useSupportIdentity(enabled: boolean) {
  return useQuery({ queryKey: supportKeys.identity, queryFn: () => api<SupportIdentity>("/support/identity"), enabled, staleTime: Infinity, retry: false });
}

export function useSupportConversations(enabled: boolean) {
  return useQuery({
    queryKey: supportKeys.conversations,
    queryFn: async () => (await api<{ conversations: SupportConversation[] }>("/support/conversations")).conversations,
    enabled,
    refetchOnWindowFocus: true,
  });
}

export function useReportProblem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { description: string; page?: string; release?: string; error_id?: string }) =>
      api<{ conversation_id: number }>("/support/report", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: supportKeys.conversations }),
  });
}
