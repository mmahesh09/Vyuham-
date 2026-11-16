/**
 * The last few failed API calls in this browser tab, for the AI assistant's context.
 *
 * Kept in memory only (gone on reload), never sent anywhere by itself: the assistant shows it to the
 * customer and includes it only if they choose to share it. Ids in paths are masked, messages are
 * truncated, and for SQL Lab only the query's shape is kept (literal values replaced with ?).
 * The server redacts everything again before storing or using it.
 */

export type RecentApiError = {
  path: string;
  method: string;
  status: number;
  message: string;
  at: number;
  /** SQL Lab only: the query with literals replaced by `?`. */
  sql?: string;
};

const MAX = 10;
const buffer: RecentApiError[] = [];

function maskPath(path: string): string {
  return path
    .split("?")[0]
    .replace(/\/(s|invite)\/[^/]+/g, "/$1/[token]")
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, "/:id");
}

/** Keep a query's shape, drop its values. */
export function sqlShape(sql: string): string {
  return sql
    .slice(0, 4000)
    .replace(/'(?:[^']|'')*'/g, "'?'")
    .replace(/(?<![\w."])-?\d+(?:\.\d+)?(?![\w."])/g, "?");
}

export function recordApiError(path: string, init: RequestInit, status: number, message: string) {
  if (status === 401) return; // signed out: not a support problem
  let sql: string | undefined;
  if (path.startsWith("/sql/run") && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body) as { sql?: unknown };
      if (typeof body.sql === "string") sql = sqlShape(body.sql);
    } catch {
      /* not JSON */
    }
  }
  buffer.unshift({ path: maskPath(path), method: (init.method ?? "GET").toUpperCase(), status, message: message.slice(0, 300), at: Date.now(), sql });
  buffer.length = Math.min(buffer.length, MAX);
}

export function recentApiErrors(): RecentApiError[] {
  return [...buffer];
}
