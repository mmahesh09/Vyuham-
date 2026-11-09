"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, LogOut, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, ApiError, type User } from "@/lib/api/client";
import { authClient } from "@/lib/auth-client";

type Danger = { kind: "leave" | "workspace" | "account" } | null;

/** Password, data export and the deletes behind the DPDP rights in the privacy policy. */
export function AccountPanel({ user }: { user: User }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwState, setPwState] = useState<{ status: "idle" | "saving" | "done" | "error"; message?: string }>({ status: "idle" });
  const [exporting, setExporting] = useState(false);
  const [danger, setDanger] = useState<Danger>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = user.role === "owner";

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 8) return setPwState({ status: "error", message: "Use at least 8 characters." });
    setPwState({ status: "saving" });
    const { error } = await authClient.changePassword({ currentPassword: pw.current, newPassword: pw.next, revokeOtherSessions: true });
    if (error) setPwState({ status: "error", message: error.code === "INVALID_PASSWORD" ? "Your current password isn't right." : (error.message ?? "Couldn't change it.") });
    else (setPwState({ status: "done" }), setPw({ current: "", next: "" }));
  };

  const download = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/account/export", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: `vyuham-export.zip` });
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("We couldn't prepare your export. Try again in a moment.");
    } finally {
      setExporting(false);
    }
  };

  const expected = danger?.kind === "account" ? user.email : danger?.kind === "workspace" ? user.workspace.name : "";
  const run = async () => {
    if (!danger) return;
    setBusy(true);
    setError(null);
    try {
      if (danger.kind === "account") {
        await api<void>("/account", { method: "DELETE", body: JSON.stringify({ confirm }) });
        await authClient.signOut().catch(() => {});
        qc.clear();
        router.replace("/");
        return;
      }
      if (danger.kind === "workspace") await api<void>("/workspace", { method: "DELETE", body: JSON.stringify({ confirm }) });
      else await api<void>("/workspace/leave", { method: "POST" });
      qc.clear();
      setDanger(null);
      router.replace("/home");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const copy = {
    leave: { title: `Leave ${user.workspace.name}?`, body: "You'll lose access to its data, dashboards and tasks. Tasks assigned to you become unassigned. You'll get a fresh, empty workspace of your own.", action: "Leave workspace" },
    workspace: { title: `Delete ${user.workspace.name} for everyone?`, body: "Every dataset, dashboard, alert, task and invite in this workspace is permanently deleted, for all members. This can't be undone.", action: "Delete workspace" },
    account: { title: "Delete your account?", body: "Your account, profile, status, leave history and notifications are erased. If you're alone in your workspace, its data is deleted too; otherwise shared work stays with your team. This can't be undone.", action: "Delete my account" },
  } as const;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={changePassword} className="flex flex-col gap-3" aria-labelledby="pw-heading">
        <h3 id="pw-heading" className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-highlight" aria-hidden /> Change password
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="pw-current">Current password</FieldLabel>
            <Input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="pw-next">New password</FieldLabel>
            <Input id="pw-next" type="password" autoComplete="new-password" minLength={8} maxLength={72} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" disabled={pwState.status === "saving"}>
            {pwState.status === "saving" ? "Saving…" : "Update password"}
          </Button>
          <span role="status" className={pwState.status === "error" ? "text-[13px] text-accent" : "text-[13px] text-highlight"}>
            {pwState.status === "done" ? "Password changed. Other devices were signed out." : pwState.message}
          </span>
        </div>
        <p className="text-xs text-faint">Signed in with Google or Apple only? Use “Forgot password” on the login page to set one.</p>
      </form>

      <div className="flex flex-col gap-2 border-t border-line pt-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Download className="size-4 text-highlight" aria-hidden /> Your data
        </h3>
        <p className="text-[13px] text-muted">Download everything we hold about you, plus the files you uploaded, as a ZIP.</p>
        <Button variant="outline" className="self-start" onClick={download} disabled={exporting}>
          <Download /> {exporting ? "Preparing…" : "Download my data"}
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-5">
        <h3 className="text-sm font-semibold text-accent">Danger zone</h3>
        {error && !danger && <p className="text-[13px] text-accent">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => (setDanger({ kind: "leave" }), setConfirm(""), setError(null))}>
            <LogOut /> Leave workspace
          </Button>
          {isOwner && (
            <Button variant="outline" className="text-accent" onClick={() => (setDanger({ kind: "workspace" }), setConfirm(""), setError(null))}>
              <Trash2 /> Delete workspace
            </Button>
          )}
          <Button variant="outline" className="text-accent" onClick={() => (setDanger({ kind: "account" }), setConfirm(""), setError(null))}>
            <Trash2 /> Delete account
          </Button>
        </div>
      </div>

      <AlertDialog open={danger !== null} onOpenChange={(o) => !o && setDanger(null)}>
        {danger && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{copy[danger.kind].title}</AlertDialogTitle>
              <AlertDialogDescription>{copy[danger.kind].body}</AlertDialogDescription>
            </AlertDialogHeader>
            {expected && (
              <Field>
                <FieldLabel htmlFor="danger-confirm">
                  Type <strong className="text-text">{expected}</strong> to confirm
                </FieldLabel>
                <Input id="danger-confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
            )}
            {error && <p className="text-[13px] text-accent">{error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={
                  busy ||
                  (!!expected &&
                    (danger.kind === "account" ? confirm.trim().toLowerCase() !== expected.toLowerCase() : confirm.trim() !== expected))
                }
                onClick={run}
              >
                {busy ? "Working…" : copy[danger.kind].action}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}
