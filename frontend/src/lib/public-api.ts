import "server-only";

import { BACKEND_URL } from "@/lib/api/server";

/**
 * Server-side reads of the public API (help center, status page), cached for `revalidate` seconds.
 * Returns null when the backend is down or answers an error, so public pages degrade instead of failing.
 */
export async function publicGet<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type HelpArticle = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  updated_at: string;
  body: string;
  helpful_yes: number;
  helpful_no: number;
};
export type HelpSummary = Omit<HelpArticle, "body" | "helpful_yes" | "helpful_no">;

export type ComponentState = "operational" | "degraded" | "major_outage" | "maintenance";
export type StatusIncident = {
  id: string;
  title: string;
  impact: "minor" | "major" | "maintenance";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  components: string[];
  created_at: string;
  resolved_at: string | null;
  updates: { id: string; status: string; message: string; created_at: string }[];
};
export type StatusSummary = {
  overall: ComponentState;
  updated_at: string;
  checks_stale: boolean;
  components: { id: string; name: string; state: ComponentState; uptime_90d: number | null; days: Record<string, number> }[];
  active_incidents: StatusIncident[];
  recent_incidents: StatusIncident[];
};
