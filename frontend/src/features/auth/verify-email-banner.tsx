"use client";

import { MailCheck, X } from "lucide-react";
import { useState } from "react";

import { useMe } from "@/features/auth/hooks";
import { authClient } from "@/lib/auth-client";

/** Reminds people to confirm their email; confirmed addresses can invite teammates and email alerts. */
export function VerifyEmailBanner() {
  const { data: me } = useMe();
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  if (!me || me.email_verified || hidden) return null;

  const resend = async () => {
    setState("sending");
    const { error } = await authClient.sendVerificationEmail({ email: me.email, callbackURL: "/home" });
    setState(error ? "error" : "sent");
  };

  return (
    <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-primary/50 bg-line/40 px-4 py-3 text-sm">
      <MailCheck className="size-4 shrink-0 text-highlight" aria-hidden />
      <span className="flex-1">
        Confirm your email (<strong className="text-text">{me.email}</strong>) to invite teammates and get alerts by email. We sent you a link.
      </span>
      {state === "sent" ? (
        <span className="text-highlight">Sent — check your inbox.</span>
      ) : (
        <button type="button" onClick={resend} disabled={state === "sending"} className="font-medium text-highlight underline-offset-4 hover:underline disabled:opacity-60">
          {state === "sending" ? "Sending…" : state === "error" ? "Try again" : "Resend link"}
        </button>
      )}
      <button type="button" onClick={() => setHidden(true)} aria-label="Hide for now" className="rounded p-1 text-faint hover:text-text">
        <X className="size-4" />
      </button>
    </div>
  );
}
