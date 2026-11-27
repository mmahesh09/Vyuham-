import { getAllPosts } from "@/lib/blog";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/**
 * /llms.txt (llmstxt.org): a plain-text map of the site for AI assistants and search tools.
 * Built from the same sources as the sitemap, so links never go stale.
 */
export async function GET() {
  const posts = (await getAllPosts()).filter((p) => !p.draft);
  const u = (path: string) => `${SITE_URL}${path}`;

  const body = `# ${SITE_NAME}

> ${SITE_NAME} is a web app for business analytics and data engineering. You upload spreadsheets or connect a PostgreSQL or MySQL database, ask questions in plain English, build dashboards, and build SQL pipelines and self-refreshing tables on the same data. It is free during the beta.

Key facts:
- File uploads: CSV, Excel (.xlsx), JSON and Parquet, up to 10 MB per file during the beta.
- Database connections: PostgreSQL and MySQL, read-only. Vyuham never writes to a connected database.
- Analytics: plain-English questions, dashboards, a SQL Workbench, metrics, alerts and scheduled reports.
- Data engineering: pipelines of SQL steps, dynamic tables that refresh on a schedule, data quality rules and lineage.
- Governance: roles per workspace, column masking and hidden columns, enforced inside the query engine.
- AI: an assistant that writes, explains and fixes SQL and drafts pipelines. Changes it proposes are shown for approval before anything runs.

## Product
- [Home](${u("/")}): what Vyuham does and who it is for
- [Pricing](${u("/pricing")}): plans, limits, AI credits and a feature comparison
- [Try with sample data](${u("/try")}): ask questions about a sample dataset without signing up
- [About](${u("/about")}): why it exists and what it doesn't do yet

## Help
- [Support center](${u("/support-center")}): help topics and how to reach support
- [Help center](${u("/help")}): how-to articles
- [System status](${u("/status")}): current status of the service

## Blog
${posts.map((p) => `- [${p.title}](${u(`/blog/${p.slug}`)}): ${p.description}`).join("\n")}

## Optional
- [Privacy policy](${u("/privacy")})
- [Terms of service](${u("/terms")})
- [Blog RSS feed](${u("/blog/rss.xml")})
`;

  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
