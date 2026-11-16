import type { RecentApiError } from "@/lib/api/recent-errors";

import type { AssistantModule } from "./api";

export const MODULE_LABEL: Record<AssistantModule, string> = {
  sql_lab: "SQL Lab",
  dashboard: "Dashboards",
  automations: "Automations",
  reports: "Scheduled reports",
  datasets: "Data uploads",
  alerts: "Alerts",
  auth: "Sign-in",
  other: "Something else",
};

/** Modules the customer can pick, in the order shown. */
export const PICKABLE: AssistantModule[] = ["sql_lab", "dashboard", "automations", "reports", "datasets", "other"];

export const SUGGESTIONS: Record<AssistantModule, string[]> = {
  sql_lab: ["Why does my query fail with a conversion error?", "What does \"column not found\" mean?", "Why is my query so slow or cut off?"],
  dashboard: ["Why is a chart on my dashboard empty?", "Why does a chart show an error?", "Why don't my filters change the charts?"],
  automations: ["Why didn't my automation run?", "Why is my alert showing an error?", "How do I fix a failing schedule?"],
  reports: ["Why didn't my scheduled report arrive?", "Why does my report webhook fail?", "Why is my report missing charts?"],
  datasets: ["Why won't my spreadsheet upload?", "Why are some columns the wrong type?", "How do I replace a dataset's data?"],
  alerts: ["Why is my alert showing an error?", "Why didn't my alert fire?"],
  auth: ["I can't sign in", "I didn't get the confirmation email"],
  other: ["Something isn't working as expected", "How do I contact a person?"],
};

/** Which module the customer is probably asking about, from the page they were on. */
export function moduleFromPath(path: string | undefined): { module: AssistantModule; dashboardId?: string } {
  if (!path) return { module: "other" };
  if (path.startsWith("/sql")) return { module: "sql_lab" };
  const dash = path.match(/^\/dashboards\/([^/]+)$/);
  if (dash && dash[1] !== "new") return { module: "dashboard", dashboardId: dash[1] };
  if (path.startsWith("/dashboards") || path.startsWith("/lab")) return { module: "dashboard" };
  if (path.startsWith("/alerts")) return { module: "automations" };
  if (path.startsWith("/data")) return { module: "datasets" };
  return { module: "other" };
}

const API_PREFIX: Partial<Record<AssistantModule, string[]>> = {
  sql_lab: ["/sql"],
  dashboard: ["/dashboards", "/charts", "/s/"],
  automations: ["/automations", "/alerts"],
  reports: ["/automations"],
  datasets: ["/datasets"],
};

/** Recent failed API calls that belong to this module (newest first). */
export function errorsForModule(errors: RecentApiError[], module: AssistantModule): RecentApiError[] {
  const prefixes = API_PREFIX[module];
  return prefixes ? errors.filter((e) => prefixes.some((p) => e.path.startsWith(p))) : [];
}
