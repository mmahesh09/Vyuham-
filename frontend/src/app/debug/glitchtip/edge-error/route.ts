import { requireTestRoutes } from "../enabled";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET() {
  requireTestRoutes();
  throw new Error("GlitchTip test: Edge route handler error");
}
