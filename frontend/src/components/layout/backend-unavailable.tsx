"use client";

import { RotateCw, ServerCrash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useLogout } from "@/features/auth/hooks";

/** Shown instead of the app when the user is signed in but the FastAPI backend is down. */
export function BackendUnavailable({ detail }: { detail: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const logout = useLogout();

  return (
    <main className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center gap-6 px-5 py-16">
      <ServerCrash className="size-10 text-accent" strokeWidth={1.6} aria-hidden />
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-[32px] font-semibold leading-tight">You&apos;re signed in, but the API isn&apos;t answering</h1>
        <p className="text-base leading-relaxed text-muted">
          {detail} Your account is fine — the app needs the backend running to load your workspace.
        </p>
      </div>
      <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-4">
        <p className="text-sm text-faint">Start it in another terminal:</p>
        <pre className="overflow-x-auto font-mono text-[13px] leading-relaxed text-highlight">
          {"cd backend\n.venv/Scripts/alembic upgrade head\n.venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload"}
        </pre>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => startTransition(() => router.refresh())}
          disabled={pending}
          className="btn-lift inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-white disabled:opacity-60"
        >
          <RotateCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden />
          Try again
        </button>
        <button
          type="button"
          onClick={() => logout.mutate()}
          className="inline-flex min-h-11 items-center rounded-full border border-line px-6 text-[15px] font-medium text-text hover:bg-surface"
        >
          Log out
        </button>
      </div>
    </main>
  );
}
