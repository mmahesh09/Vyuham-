"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

function RenderCrash(): never {
  throw new Error("GlitchTip test: browser render crash");
}

export function TestButtons() {
  const [crash, setCrash] = useState(false);
  const [status, setStatus] = useState("");
  const call = async (path: string) => setStatus(`${path} answered ${(await fetch(path)).status}`);

  const buttons: [string, () => void][] = [
    ["Browser: unhandled exception", () => setTimeout(() => { throw new Error("GlitchTip test: unhandled browser exception"); })],
    ["Browser: unhandled promise rejection", () => void Promise.reject(new Error("GlitchTip test: unhandled promise rejection"))],
    ["Browser: captured exception", () => setStatus(`sent ${Sentry.captureException(new Error("GlitchTip test: captured browser exception"))}`)],
    ["Browser: render crash (global error page)", () => setCrash(true)],
    ["Server: route handler error", () => void call("/debug/glitchtip/server-error")],
    ["Edge: route handler error", () => void call("/debug/glitchtip/edge-error")],
    ["Server: server component crash", () => window.location.assign("/debug/glitchtip/crash")],
  ];

  return (
    <div className="flex flex-col items-start gap-2">
      {crash && <RenderCrash />}
      {buttons.map(([label, run]) => (
        <button key={label} type="button" onClick={run} className="rounded-md border px-3 py-1.5 text-sm hover:bg-white/5">
          {label}
        </button>
      ))}
      {status && <p className="text-xs opacity-70">{status}</p>}
    </div>
  );
}
