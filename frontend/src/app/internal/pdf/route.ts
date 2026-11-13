/**
 * POST /internal/pdf  {"token": "<signed print token>", "page_size": "A4" | "Letter", "landscape": false}
 *
 * Renders a dashboard report to PDF with Forme, no browser needed. Called by the report worker
 * (backend/app/reports/pdf.py) instead of opening the print page in Chromium. The signed print token
 * is the only credential: the backend checks it when this route loads the dashboard, exactly as the
 * print page does. Errors come back as JSON {error}: 404 for an expired or unknown token (the worker
 * fails the report), 502 when the backend can't be reached (the worker falls back to Chromium).
 */
import type { Dashboard, DashboardView } from "@/features/dashboards/api";
import { renderDashboardPdf } from "@/features/reports/pdf-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

async function load<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, { cache: "no-store" });
  } catch {
    return { ok: false, status: 502, error: "The PDF renderer couldn't reach the API." };
  }
  if (res.ok) return { ok: true, data: (await res.json()) as T };
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  return { ok: false, status: res.status === 404 ? 404 : 502, error: typeof body?.detail === "string" ? body.detail : `The API answered ${res.status}.` };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: unknown; page_size?: unknown; landscape?: unknown } | null;
  if (!body || typeof body.token !== "string" || !body.token) return Response.json({ error: "Missing print token." }, { status: 400 });
  const t = encodeURIComponent(body.token);
  const [meta, view] = await Promise.all([load<Dashboard>(`/print/dashboards/${t}`), load<DashboardView>(`/print/dashboards/${t}/view`)]);
  if (!meta.ok) return Response.json({ error: meta.error }, { status: meta.status });
  if (!view.ok) return Response.json({ error: view.error }, { status: view.status });

  const pageSize = body.page_size === "Letter" ? "Letter" : "A4";
  const bytes = await renderDashboardPdf(meta.data, view.data, { pageSize, landscape: body.landscape === true });
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store", "X-PDF-Renderer": "forme" },
  });
}
