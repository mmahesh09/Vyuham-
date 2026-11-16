"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";

/** Mirrors backend/app/routers/assistant.py. All AI work happens on the server. */
export type AssistantModule = "sql_lab" | "dashboard" | "automations" | "reports" | "datasets" | "alerts" | "auth" | "other";

export type StepKind = "verified_fix" | "suggestion" | "check";
export type Confidence = "high" | "medium" | "low" | "insufficient_evidence";

export type AssistantAnswer = {
  summary: string;
  likely_root_cause: string;
  confidence: Confidence;
  steps: { text: string; kind: StepKind; article_ids: string[] }[];
  uncertainty: string;
  needs_human: boolean;
  cited_article_ids: string[];
  grounded: boolean;
};

export type ArticleRef = { id: string; title: string; scope: "global" | "tenant"; cited: boolean; verified: boolean };

export type AssistantSession = {
  id: string;
  thread_id: string;
  module: AssistantModule;
  question: string;
  status: "queued" | "running" | "answered" | "failed";
  answer: AssistantAnswer | null;
  failure: string | null;
  references: ArticleRef[];
  feedback: "resolved" | "unresolved" | null;
  escalated_conversation_id: number | null;
  shared_context: Record<string, unknown> | null;
  created_at: string;
  answered_at: string | null;
  can_escalate?: boolean;
};

export type ThreadSummary = { thread_id: string; module: AssistantModule; title: string; turns: number; last_at: string; feedback: string | null; escalated: boolean };

export type Article = { id: string; title: string; scope: "global" | "tenant"; symptoms: string; root_cause: string; resolution: string; verified: boolean };

export type ErrorReport = { module: AssistantModule; message: string; error_type?: string; http_status?: number; details?: Record<string, unknown>; app_version?: string };

export const assistantKeys = {
  session: (id: string) => ["assistant", "session", id] as const,
  thread: (id: string) => ["assistant", "thread", id] as const,
  threads: ["assistant", "threads"] as const,
  article: (id: string) => ["assistant", "article", id] as const,
  context: (module: string, dashboardId?: string) => ["assistant", "context", module, dashboardId ?? ""] as const,
};

/** Polls until the background job has answered (or failed). */
export function useAssistantSession(id: string, initial?: AssistantSession) {
  return useQuery({
    queryKey: assistantKeys.session(id),
    queryFn: () => api<AssistantSession>(`/support/assistant/sessions/${id}`),
    initialData: initial,
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 1500 : false),
  });
}

export function useThreads(enabled: boolean) {
  return useQuery({ queryKey: assistantKeys.threads, queryFn: async () => (await api<{ threads: ThreadSummary[] }>("/support/assistant/threads")).threads, enabled });
}

export function useThread(id: string | null) {
  return useQuery({
    queryKey: assistantKeys.thread(id ?? ""),
    queryFn: async () => (await api<{ sessions: AssistantSession[] }>(`/support/assistant/threads/${id}`)).sessions,
    enabled: Boolean(id),
  });
}

export function useArticle(id: string | null) {
  return useQuery({ queryKey: assistantKeys.article(id ?? ""), queryFn: () => api<Article>(`/support/assistant/articles/${id}`), enabled: Boolean(id), staleTime: 5 * 60_000 });
}

/** Server-built, redacted diagnostics for the current module. Only fetched when the customer opens the preview. */
export function useModuleContext(module: AssistantModule, dashboardId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: assistantKeys.context(module, dashboardId),
    queryFn: () => api<Record<string, unknown>>(`/support/assistant/context?module=${module}${dashboardId ? `&dashboard_id=${dashboardId}` : ""}`),
    enabled,
    staleTime: 30_000,
  });
}

export function useAsk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { question: string; module: AssistantModule; thread_id?: string; error?: ErrorReport; context?: Record<string, unknown> }) =>
      api<AssistantSession>("/support/assistant/ask", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (s) => {
      queryClient.setQueryData(assistantKeys.session(s.id), s);
      queryClient.invalidateQueries({ queryKey: assistantKeys.threads });
    },
  });
}

export function useFeedback(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { resolved: boolean; comment?: string }) =>
      api<AssistantSession>(`/support/assistant/sessions/${sessionId}/feedback`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (s) => queryClient.setQueryData(assistantKeys.session(sessionId), s),
  });
}

export function useEscalate(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { message?: string; include_diagnostics: boolean }) =>
      api<{ conversation_id: number }>(`/support/assistant/sessions/${sessionId}/escalate`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: assistantKeys.session(sessionId) });
      queryClient.invalidateQueries({ queryKey: ["support", "conversations"] });
    },
  });
}
