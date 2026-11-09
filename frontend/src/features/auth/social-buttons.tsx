"use client";

import { useState } from "react";

import type { SocialProvider } from "@/lib/auth";

import { useSocialSignIn } from "./hooks";
import { FormError } from "./fields";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M16.37 12.78c-.02-2.27 1.86-3.37 1.94-3.42-1.06-1.55-2.7-1.76-3.28-1.78-1.4-.14-2.73.82-3.44.82-.71 0-1.8-.8-2.96-.78-1.52.02-2.93.89-3.71 2.25-1.59 2.75-.41 6.81 1.13 9.04.76 1.09 1.66 2.31 2.83 2.27 1.14-.05 1.57-.73 2.94-.73 1.37 0 1.76.73 2.96.71 1.22-.02 2-1.11 2.74-2.21.87-1.26 1.22-2.49 1.24-2.55-.03-.01-2.37-.91-2.39-3.62zM14.12 6.1c.62-.76 1.05-1.81.93-2.86-.9.04-2 .6-2.65 1.36-.58.67-1.09 1.75-.95 2.78 1.01.08 2.04-.51 2.67-1.28z" />
    </svg>
  );
}

const PROVIDERS: { id: SocialProvider; label: string; mark: React.ReactNode }[] = [
  { id: "google", label: "Google", mark: <GoogleMark /> },
  { id: "apple", label: "Apple", mark: <AppleMark /> },
];

/** "Log in with Google / Apple". A provider without credentials stays visible and says so when clicked. */
export function SocialButtons({ verb, enabled }: { verb: "Log in" | "Sign up"; enabled: Record<SocialProvider, boolean> }) {
  const social = useSocialSignIn();
  const [notReady, setNotReady] = useState<string | null>(null);
  // isSuccess too: the browser is navigating away to the provider.
  const pendingProvider = social.isPending || social.isSuccess ? social.variables : undefined;

  function start(provider: SocialProvider, label: string) {
    if (!enabled[provider]) {
      social.reset();
      setNotReady(`${label} sign-in isn't set up yet. Use your email and password for now.`);
      return;
    }
    setNotReady(null);
    social.mutate(provider);
  }

  return (
    <div className="flex flex-col gap-3">
      {PROVIDERS.map(({ id, label, mark }) => (
        <button
          key={id}
          type="button"
          onClick={() => start(id, label)}
          disabled={pendingProvider !== undefined}
          className="flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] border border-line bg-surface text-[15px] font-medium text-text transition-[background-color,border-color] duration-200 hover:border-[#3a3170] hover:bg-surface-2 disabled:cursor-wait disabled:opacity-70"
        >
          {mark}
          {pendingProvider === id ? `Opening ${label}…` : `${verb} with ${label}`}
        </button>
      ))}
      <FormError message={notReady ?? social.error?.message} />
    </div>
  );
}
