import { BarChart3, CreditCard, FileSpreadsheet, LayoutDashboard, Rocket, Users, type LucideIcon } from "lucide-react";

/**
 * The six help topics. An article belongs to a topic when one of its tags contains one of the
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
    text: "Phrasing a question, reading the answer and checking how it was worked out.",
    icon: BarChart3,
    keys: ["question", "ask", "ai", "answer", "analytic", "metric", "insight"],
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
