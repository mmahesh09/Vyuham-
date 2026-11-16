import { requireTestRoutes } from "../enabled";

export const dynamic = "force-dynamic";

export default function ServerComponentCrash() {
  requireTestRoutes();
  throw new Error("GlitchTip test: server component crash");
}
