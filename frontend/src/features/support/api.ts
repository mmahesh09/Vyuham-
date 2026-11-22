"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";

/** Mirrors backend/app/support_schemas.py. */
export type Category = "bug" | "question" | "billing" | "feature";
export type Priority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "pending" | "resolved" | "closed";

export type Attachment = { id: string; filename: string; content_type: string; size: number };
export type Message = {
  id: string;
  author_name: string;
  is_staff: boolean;
  internal: boolean;
  body: string;
  created_at: string;
  attachments: Attachment[];
};

/** Mirrors ATTACHMENT_TYPES / MAX_ATTACHMENT_BYTES in backend/app/routers/support.py. */
export const ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.csv,.xlsx";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export const attachmentUrl = (id: string) => `/api/support/attachments/${id}`;

export type Ticket = {
  id: string;
  subject: string;
  category: Category;
  priority: Priority;
  status: TicketStatus;
  error_event_id: string | null;
  kb_article_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  /** Someone from support has replied in the visible conversation (internal notes don't count). */
  staff_replied: boolean;
  /** The newest message the customer can see, trimmed. */
  latest_reply: { author_name: string; is_staff: boolean; excerpt: string; created_at: string } | null;
};
export type TicketDetail = Ticket & { messages: Message[]; kb_article?: { slug: string; title: string } | null };

export type StaffTicket = Ticket & {
  workspace_name: string;
  requester_name: string;
  requester_email: string;
  page_url: string | null;
  error_group_id: string | null;
  first_response_at: string | null;
};
export type StaffTicketDetail = StaffTicket & { messages: Message[] };

export type ArticleSummary = { id: string; slug: string; title: string; summary: string; tags: string[]; updated_at: string };
export type StaffArticle = ArticleSummary & {
  body: string;
  helpful_yes: number;
  helpful_no: number;
  status: "draft" | "published";
  views: number;
  source_ticket_id: string | null;
  published_at: string | null;
};
export type ArticleInput = { title: string; summary: string; body: string; tags: string[]; status: "draft" | "published"; slug?: string };

export type ErrorGroup = {
  id: string;
  glitchtip_issue_id: string;
  title: string;
  culprit: string | null;
  level: string;
  url: string | null;
  status: "new" | "known" | "fixed";
  count: number;
  kb_article_id: string | null;
  first_seen: string;
  last_seen: string;
  ticket_count: number;
};

export type Metrics = {
  tickets_this_week: number;
  open_tickets: number;
  median_first_response_hours: number | null;
  deflections_this_week: number;
  deflection_rate: number | null;
  new_errors_this_week: number;
  errors_without_article: number;
};

export const CATEGORY_LABEL: Record<Category, string> = {
  bug: "Something isn't working",
  question: "How do I…?",
  billing: "Billing or account",
  feature: "Idea or request",
};
export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Waiting on support",
  pending: "Waiting on you",
  resolved: "Resolved",
  closed: "Closed",
};

/**
 * What a customer sees. The backend stores open / pending / resolved / closed; "In progress" is an
 * open request support has already replied to (the customer answered and it's back with the team).
 */
export type RequestState = "open" | "in_progress" | "waiting" | "resolved" | "closed";
export const REQUEST_STATE_LABEL: Record<RequestState, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting for your response",
  resolved: "Resolved",
  closed: "Closed",
};
export function requestState(t: Pick<Ticket, "status" | "staff_replied">): RequestState {
  if (t.status === "pending") return "waiting";
  if (t.status === "open") return t.staff_replied ? "in_progress" : "open";
  return t.status;
}

const keys = {
  mine: ["support", "tickets"] as const,
  ticket: (id: string) => ["support", "ticket", id] as const,
  inbox: (status: string, q: string) => ["support", "admin", "tickets", status, q] as const,
  staffTicket: (id: string) => ["support", "admin", "ticket", id] as const,
  errors: ["support", "admin", "errors"] as const,
  metrics: ["support", "admin", "metrics"] as const,
  articles: ["kb", "admin", "articles"] as const,
  article: (id: string) => ["kb", "admin", "article", id] as const,
  search: (q: string) => ["kb", "search", q] as const,
};

// ---------- customers ----------

export function useMyTickets(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: keys.mine, queryFn: () => api<Ticket[]>("/support/tickets"), enabled: opts.enabled ?? true });
}

export function useTicket(id: string) {
  return useQuery({ queryKey: keys.ticket(id), queryFn: () => api<TicketDetail>(`/support/tickets/${id}`) });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      subject: string;
      body: string;
      category: Category;
      page_url?: string;
      error_event_id?: string;
      attachment_ids?: string[];
    }) =>
      api<TicketDetail>("/support/tickets", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.mine }),
  });
}

export function useReply(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, attachment_ids = [] }: { body: string; attachment_ids?: string[] }) =>
      api<TicketDetail>(`/support/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ body, attachment_ids }) }),
    onSuccess: (t) => qc.setQueryData(keys.ticket(id), t),
  });
}

export function useResolve(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<TicketDetail>(`/support/tickets/${id}/resolve`, { method: "POST" }),
    onSuccess: (t) => {
      qc.setQueryData(keys.ticket(id), t);
      qc.invalidateQueries({ queryKey: keys.mine });
    },
  });
}

/** Search-as-you-type on the new-ticket form (published articles only). */
export function useArticleSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: keys.search(term),
    queryFn: () => api<ArticleSummary[]>(`/kb/search?q=${encodeURIComponent(term)}&limit=4`),
    enabled: term.length >= 4,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

/** One file for a request or reply; send the returned id in attachment_ids. */
export function uploadAttachment(file: File) {
  const form = new FormData();
  form.append("file", file);
  return api<Attachment>("/support/attachments", { method: "POST", body: form });
}

export function logDeflection(articleId: string) {
  // Fire and forget: counting must never get in the way of reading the article.
  api("/kb/deflections", { method: "POST", body: JSON.stringify({ article_id: articleId }) }).catch(() => {});
}

// ---------- staff ----------

export function useInbox(status: string, q: string) {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (q.trim()) params.set("q", q.trim());
  return useQuery({ queryKey: keys.inbox(status, q.trim()), queryFn: () => api<StaffTicket[]>(`/support/admin/tickets?${params}`) });
}

export function useMetrics() {
  return useQuery({ queryKey: keys.metrics, queryFn: () => api<Metrics>("/support/admin/metrics") });
}

export function useStaffTicket(id: string) {
  return useQuery({ queryKey: keys.staffTicket(id), queryFn: () => api<StaffTicketDetail>(`/support/admin/tickets/${id}`) });
}

export function useStaffReply(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { body: string; internal: boolean; attachment_ids?: string[] }) =>
      api<StaffTicketDetail>(`/support/admin/tickets/${id}/messages`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (t) => {
      qc.setQueryData(keys.staffTicket(id), t);
      qc.invalidateQueries({ queryKey: ["support", "admin", "tickets"] });
    },
  });
}

export function usePatchTicket(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<StaffTicket, "status" | "priority" | "error_group_id" | "kb_article_id">>) =>
      api<StaffTicketDetail>(`/support/admin/tickets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (t) => {
      qc.setQueryData(keys.staffTicket(id), t);
      qc.invalidateQueries({ queryKey: ["support", "admin", "tickets"] });
    },
  });
}

export function useTicketToArticle(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<StaffArticle>(`/support/admin/tickets/${id}/to-article`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.staffTicket(id) });
      qc.invalidateQueries({ queryKey: keys.articles });
    },
  });
}

export function useErrorGroups() {
  return useQuery({ queryKey: keys.errors, queryFn: () => api<ErrorGroup[]>("/support/admin/errors") });
}

export function usePatchError() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: ErrorGroup["status"]; kb_article_id?: string | null }) =>
      api<ErrorGroup>(`/support/admin/errors/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.errors }),
  });
}

export function useArticles() {
  return useQuery({ queryKey: keys.articles, queryFn: () => api<StaffArticle[]>("/kb/admin/articles") });
}

export function useArticle(id: string | null) {
  return useQuery({ queryKey: keys.article(id ?? ""), queryFn: () => api<StaffArticle>(`/kb/admin/articles/${id}`), enabled: !!id });
}

export function useSaveArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ArticleInput & { id?: string }) =>
      api<StaffArticle>(id ? `/kb/admin/articles/${id}` : "/kb/admin/articles", { method: id ? "PUT" : "POST", body: JSON.stringify(body) }),
    onSuccess: (a) => {
      qc.setQueryData(keys.article(a.id), a);
      qc.invalidateQueries({ queryKey: keys.articles });
    },
  });
}

export function useDeleteArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/kb/admin/articles/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.articles }),
  });
}
