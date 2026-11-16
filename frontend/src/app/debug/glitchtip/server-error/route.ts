import { requireTestRoutes } from "../enabled";

export const dynamic = "force-dynamic";

export function GET() {
  requireTestRoutes();
  throw new Error("GlitchTip test: Node route handler error");
}
