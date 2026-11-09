"use client";

import { Check, Copy, Link2, Link2Off, Share2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import type { Dashboard } from "./api";
import { useDashboardMutations } from "./hooks";

/** Create, copy or revoke a read-only public link to a dashboard. */
export function ShareDialog({ dashboard }: { dashboard: Dashboard }) {
  const { share, unshare } = useDashboardMutations(dashboard.id);
  const [copied, setCopied] = useState(false);
  const url = dashboard.share_token && typeof window !== "undefined" ? `${window.location.origin}/s/${dashboard.share_token}` : "";
  const blockedByProfile = share.error?.message.includes("profile");

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        <Share2 /> Share
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share “{dashboard.name}”</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this dashboard and use its filters, without an account. They can&apos;t edit anything.
          </DialogDescription>
        </DialogHeader>

        {dashboard.share_token ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} />
              <Button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-highlight hover:underline">
                <Link2 className="size-4" /> Open as a visitor
              </a>
              <Button type="button" variant="ghost" className="text-accent" disabled={unshare.isPending} onClick={() => unshare.mutate()}>
                <Link2Off /> Turn off link
              </Button>
            </div>
            <p className="text-xs text-faint">Turning the link off breaks it for everyone you sent it to. A new link gets a new address.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {share.isError && (
              <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-text">
                {share.error.message}{" "}
                {blockedByProfile && (
                  <Link href="/profile#dashboard-sharing" className="font-medium text-highlight underline">
                    Open profile
                  </Link>
                )}
              </p>
            )}
            <Button type="button" className="self-start" disabled={share.isPending} onClick={() => share.mutate()}>
              <Link2 /> {share.isPending ? "Creating…" : "Create a share link"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
