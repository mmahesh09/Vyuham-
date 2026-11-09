"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/api/client";

import type { InviteInfo } from "./api";

export const PENDING_INVITE_KEY = "vyuham:pending-invite";

/**
 * /invite/[token]: shows what the invite is for. Signed in → accept. Not signed in →
 * sign up or log in first; the token is kept so we come back here and accept straight away.
 * Deliberately outside the app and auth layouts: those call /me, which would create a
 * fresh workspace for a brand-new invitee before they get the chance to join this one.
 */
export function InviteScreen({ token }: { token: string }) {
  const router = useRouter();
  const session = authClient.useSession();
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => api<InviteInfo>(`/invites/${token}`) });
  const accept = useMutation({
    mutationFn: () => api<{ workspace_id: string }>(`/invites/${token}/accept`, { method: "POST" }),
    onSuccess: () => {
      try {
        sessionStorage.removeItem(PENDING_INVITE_KEY);
      } catch {}
      router.replace("/home");
      router.refresh();
    },
  });

  const signedIn = !!session.data?.user;
  const valid = info.data?.valid;
  // Back from sign-up/log-in with this invite pending: accept without another click.
  const auto = useRef(false);
  useEffect(() => {
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_INVITE_KEY);
    } catch {}
    if (signedIn && valid && pending === token && !auto.current) {
      auto.current = true;
      accept.mutate();
    }
  }, [signedIn, valid, token, accept]);

  const remember = () => {
    try {
      sessionStorage.setItem(PENDING_INVITE_KEY, token);
    } catch {}
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[480px] flex-col justify-center gap-6 px-5">
      {info.isPending || session.isPending ? (
        <Loader2 className="size-6 animate-spin text-highlight" aria-label="Loading" />
      ) : !info.data?.valid ? (
        <div className="flex flex-col gap-3">
          <h1 className="text-[28px] font-semibold">This invite can&apos;t be used</h1>
          <p className="text-muted">{info.data?.reason ?? info.error?.message}</p>
          <Link href="/" className="text-highlight underline">
            Go to Vyuham
          </Link>
        </div>
      ) : (
        <>
          <Users className="size-10 text-highlight" strokeWidth={1.6} aria-hidden />
          <div className="flex flex-col gap-2">
            <h1 className="text-[30px] font-semibold leading-tight">Join {info.data.workspace_name}</h1>
            <p className="text-muted">
              {info.data.invited_by ? `${info.data.invited_by} invited you` : "You've been invited"} as{" "}
              <strong className="text-text capitalize">{info.data.role}</strong> on Vyuham, to share dashboards and data tasks.
            </p>
          </div>
          {accept.isError && <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{accept.error.message}</p>}
          {signedIn ? (
            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={() => accept.mutate()} disabled={accept.isPending}>
                {accept.isPending ? "Joining…" : `Join as ${session.data?.user.name}`}
              </Button>
              <p className="text-xs text-faint">Signed in as {session.data?.user.email}.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button size="lg" className="flex-1" nativeButton={false} render={<Link href="/signup" onClick={remember} />}>
                Create an account
              </Button>
              <Button size="lg" variant="outline" className="flex-1" nativeButton={false} render={<Link href="/login" onClick={remember} />}>
                I have an account
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
