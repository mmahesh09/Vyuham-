"use client";

import { MailCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useMe } from "@/features/auth/hooks";
import { authClient } from "@/lib/auth-client";

const HIDE_KEY = "vyuham:verify-banner-hidden";

/** Reminds people to confirm their email; confirmed addresses can invite teammates and email alerts. */
export function VerifyEmailBanner() {
  const { data: me } = useMe();
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  // Hiding lasts for this browser session, so it doesn't come back on every page.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(HIDE_KEY) === "1") setHidden(true);
    } catch {
      /* storage blocked */
    }
  }, []);
  const hide = () => {
    setHidden(true);
    try {
      sessionStorage.setItem(HIDE_KEY, "1");
    } catch {
      /* not remembered */
    }
  };
  if (!me || me.email_verified || hidden) return null;

  const resend = async () => {
    setState("sending");
    const { error } = await authClient.sendVerificationEmail({ email: me.email, callbackURL: "/home" });
    setState(error ? "error" : "sent");
  };

  return (
    <div role="status" className="mx-auto mb-6 flex w-full max-w-[1400px] flex-wrap items-center gap-3 rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm text-muted">
      <MailCheck className="size-4 shrink-0 text-highlight" aria-hidden />
      <span className="flex-1">
        Confirm your email (<strong className="text-text">{me.email}</strong>) to invite teammates and get alerts by email. We sent you a link.
      </span>
      {state === "sent" ? (
        <span className="text-highlight">Sent. Check your inbox.</span>
      ) : (
        <button type="button" onClick={resend} disabled={state === "sending"} className="font-medium text-highlight underline-offset-4 hover:underline disabled:opacity-60">
          {state === "sending" ? "Sending…" : state === "error" ? "Try again" : "Resend link"}
        </button>
      )}
      <button type="button" onClick={hide} aria-label="Hide for now" className="rounded p-1 text-faint hover:text-text">
        <X className="size-4" />
      </button>
    </div>
  );
}
