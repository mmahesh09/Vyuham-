import { BarChart3, CreditCard, FileSpreadsheet, LayoutDashboard, Rocket, ShieldCheck, Users, Workflow, type LucideIcon } from "lucide-react";

/**
 * The help topics. An article belongs to a topic when one of its tags contains one of the
 * topic's keys (lowercase, partial match), so counts and lists always come from the real articles.
 */
export type HelpTopic = { id: string; title: string; text: string; icon: LucideIcon; keys: string[] };

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    text: "Your first upload, your first question and the starter dashboard.",
    icon: Rocket,
    keys: ["start", "general", "onboard", "basics"],
  },
  {
    id: "data-uploads",
    title: "Data & Uploads",
    text: "Excel and CSV files, database connections, dates and column types.",
    icon: FileSpreadsheet,
    keys: ["upload", "data", "csv", "excel", "sheet", "import", "connection", "database"],
  },
  {
    id: "analytics-questions",
    title: "Analytics & Questions",
    text: "Phrasing a question, the SQL Workbench, metrics and checking how an answer was worked out.",
    icon: BarChart3,
    keys: ["question", "ask", "answer", "analytic", "metric", "insight", "sql"],
  },
  {
    id: "pipelines-engineering",
    title: "Pipelines & Data Engineering",
    text: "Building pipelines, the AI Data Engineer, dynamic tables, quality checks and refresh history.",
    icon: Workflow,
    keys: ["pipeline", "dynamic", "transform", "engineer", "refresh", "lineage", "quality", "ai"],
  },
  {
    id: "governance-security",
    title: "Governance & Security",
    text: "Sensitive data, masking, dataset and column access, the audit log and workload costs.",
    icon: ShieldCheck,
    keys: ["governance", "mask", "privacy", "security", "pii", "audit", "permission", "cost", "usage"],
  },
  {
    id: "dashboards-sharing",
    title: "Dashboards & Sharing",
    text: "Pinning answers, filters, share links and turning a link off.",
    icon: LayoutDashboard,
    keys: ["dashboard", "share", "chart", "report", "export"],
  },
  {
    id: "teams-collaboration",
    title: "Teams & Collaboration",
    text: "Inviting teammates, roles and working on the same workspace.",
    icon: Users,
    keys: ["team", "invite", "role", "member", "collab", "workspace"],
  },
  {
    id: "account-billing",
    title: "Account & Billing",
    text: "Signing in, your email address, plans and payments.",
    icon: CreditCard,
    keys: ["billing", "account", "login", "password", "plan", "sign"],
  },
];

export function inTopic(article: { tags: string[] }, topic: HelpTopic) {
  return article.tags.some((t) => topic.keys.some((k) => t.toLowerCase().includes(k)));
}

/** The first topic an article belongs to, used as its category label. */
export function topicOf(article: { tags: string[] }): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => inTopic(article, t));
}

export function findTopic(id: string | undefined | null) {
  return HELP_TOPICS.find((t) => t.id === id);
}
