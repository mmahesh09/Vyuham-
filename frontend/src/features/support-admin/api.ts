"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api/client";

/** Mirrors backend/app/routers/support_admin.py and knowledge.py. The server authorizes every call. */
export type SupportRole = "admin" | "staff";

export type Overview = {
  days: number;
  total_events: number;
  unique_fingerprints: number;
  unresolved_errors: number;
  error_resolution_rate: number | null;
  errors_seen: number;
  by_module: { module: string; events: number }[];
  by_version: { version: string; events: number }[];
  top_errors: { fingerprint: string; module: string; category: string; error_type: string; message: string; events: number; workspaces: number; last_seen: string; open_groups: number }[];
  trend: { date: string; events: number }[];
  knowledge: { pending: number; approved: number; rejected: number; archived: number };
  ai: { answered: number; resolved: number; unresolved: number; no_feedback: number; resolution_rate: number | null; escalated: number };
  open_tickets: number | null;
};

export type ErrorGroup = {
  id: string;
  workspace_id: string;
  workspace: string | null;
  fingerprint: string;
  module: string;
  category: string;
  error_type: string;
  message: string;
  template: string;
  count: number;
  first_seen: string;
  last_seen: string;
  status: "open" | "resolved";
  resolved_at: string | null;
  resolution_note: string | null;
  regressed_at: string | null;
  chatwoot_conversation_id: number | null;
};

export type AuditEntry = { id: string; at: string; actor: string; role: string; action: string; target_type: string; target_id: string; workspace_id: string | null; changes: Record<string, [unknown, unknown]>; note: string | null };

export type AiSession = {
  id: string;
  workspace_id: string;
  workspace: string | null;
  user: string | null;
  module: string;
  question: string;
  status: string;
  summary: string | null;
  likely_root_cause: string | null;
  confidence: string | null;
  steps: { text: string; kind: string; article_ids: string[] }[];
  grounded: boolean | null;
  cited_article_ids: string[];
  feedback: "resolved" | "unresolved" | null;
  feedback_comment: string | null;
  escalated_conversation_id: number | null;
  error_group_id: string | null;
  created_at: string;
  model: string | null;
};

export type ArticleBrief = { id: string; title: string; scope: "global" | "tenant"; workspace_id: string | null; status: string; source: string; helpful_count: number; unhelpful_count: number; updated_at: string };

export type ErrorDetail = ErrorGroup & {
  events: { id: string; at: string; message: string; details: Record<string, unknown>; app_version: string | null; user: string | null }[];
  ai_sessions: AiSession[];
  articles: ArticleBrief[];
  audit: AuditEntry[];
};

export type Article = {
  id: string;
  scope: "global" | "tenant";
  workspace_id: string | null;
  workspace?: string | null;
  title: string;
  symptoms: string;
  root_cause: string;
  resolution: string;
  modules: string[];
  categories: string[];
  fingerprints: string[];
  status: "pending" | "approved" | "rejected" | "archived";
  tested: boolean;
  test_notes: string | null;
  source: string;
  source_ref: string | null;
  helpful_count: number;
  unhelpful_count: number;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type ArticleFields = Pick<Article, "title" | "symptoms" | "root_cause" | "resolution"> & { modules?: string[]; categories?: string[]; fingerprints?: string[] };

const k = {
  me: ["support-admin", "me"] as const,
  all: ["support-admin"] as const,
};

/** Whether the signed-in person is Vyuham support staff. Only hides UI; the server enforces access. */
export function useSupportAdminRole() {
  return useQuery({
    queryKey: k.me,
    queryFn: async () => {
      try {
        return await api<{ role: SupportRole; email: string }>("/support/admin/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useOverview(days: number) {
  return useQuery({ queryKey: [...k.all, "overview", days], queryFn: () => api<Overview>(`/support/admin/overview?days=${days}`) });
}

export function useErrors(filters: { status?: string; module?: string; q?: string; fingerprint?: string }) {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: [...k.all, "errors", qs], queryFn: () => api<{ total: number; errors: ErrorGroup[] }>(`/support/admin/errors?${qs}`) });
}

export function useErrorDetail(id: string | null) {
  return useQuery({ queryKey: [...k.all, "error", id], queryFn: () => api<ErrorDetail>(`/support/admin/errors/${id}`), enabled: Boolean(id) });
}

export function useArticles(status: string) {
  return useQuery({ queryKey: [...k.all, "articles", status], queryFn: async () => (await api<{ articles: Article[] }>(`/support/knowledge?status=${status}`)).articles });
}

export function useArticle(id: string | null) {
  return useQuery({ queryKey: [...k.all, "article", id], queryFn: () => api<Article>(`/support/knowledge/${id}`), enabled: Boolean(id) });
}

export function useAiSuggestions(feedback: string) {
  return useQuery({ queryKey: [...k.all, "ai", feedback], queryFn: async () => (await api<{ sessions: AiSession[] }>(`/support/admin/ai-suggestions${feedback ? `?feedback=${feedback}` : ""}`)).sessions });
}

export function useFeedback(days: number) {
  return useQuery({
    queryKey: [...k.all, "feedback", days],
    queryFn: () => api<{ by_module: { module: string; resolved: number; unresolved: number }[]; recent: AiSession[]; articles: ArticleBrief[] }>(`/support/admin/feedback?days=${days}`),
  });
}

export function useTickets() {
  return useQuery({
    queryKey: [...k.all, "tickets"],
    queryFn: () =>
      api<{ configured: boolean; error?: string; open: { count: number; conversations: { id: number; status: string; created_at: number; last_activity_at: number; labels: string[]; workspace_id: string | null; workspace?: string | null }[] } | null; linked_errors: ErrorGroup[] }>(
        "/support/admin/tickets",
      ),
  });
}

export function useAudit(targetId?: string) {
  return useQuery({ queryKey: [...k.all, "audit", targetId ?? ""], queryFn: async () => (await api<{ entries: AuditEntry[] }>(`/support/admin/audit${targetId ? `?target_id=${targetId}` : ""}`)).entries });
}

/** Any change: refresh every dashboard query so counts, lists and the audit log stay consistent. */
function useAdminMutation<TBody, TOut>(fn: (body: TBody) => Promise<TOut>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => queryClient.invalidateQueries({ queryKey: k.all }) });
}

const post = <T,>(path: string, body?: unknown, method = "POST") => api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const useResolveError = (id: string) => useAdminMutation((note: string) => post<ErrorGroup>(`/support/admin/errors/${id}/resolve`, { note }));
export const useReopenError = (id: string) => useAdminMutation(() => post<ErrorGroup>(`/support/admin/errors/${id}/reopen`));
export const useLinkTicket = (id: string) => useAdminMutation((conversation_id: number) => post<ErrorGroup>(`/support/admin/errors/${id}/ticket`, { conversation_id }));
export const useUnlinkTicket = (id: string) => useAdminMutation(() => post<ErrorGroup>(`/support/admin/errors/${id}/ticket`, undefined, "DELETE"));
export const useDraftFromSession = () => useAdminMutation((sessionId: string) => post<ArticleBrief>(`/support/admin/sessions/${sessionId}/draft-article`));
export const useCreateArticle = () => useAdminMutation((body: ArticleFields & { scope: "global" | "tenant"; workspace_id?: string }) => post<Article>("/support/knowledge", body));
export const useEditArticle = (id: string) => useAdminMutation((body: Partial<ArticleFields>) => post<Article>(`/support/knowledge/${id}`, body, "PATCH"));
export const useApproveArticle = (id: string) => useAdminMutation((body: { tested: boolean; test_notes: string; confirm_no_customer_data: boolean }) => post<Article>(`/support/knowledge/${id}/approve`, body));
export const useRejectArticle = (id: string) => useAdminMutation((note: string) => post<Article>(`/support/knowledge/${id}/reject`, { note }));
export const useArchiveArticle = (id: string) => useAdminMutation(() => post<Article>(`/support/knowledge/${id}/archive`));
