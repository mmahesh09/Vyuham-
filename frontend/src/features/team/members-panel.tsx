"use client";

import { format, formatDistanceToNow, parseISO } from "date-fns";
import { Check, Copy, Link2, UserMinus, UserPlus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LEAVE_LABEL, PresenceAvatar, STATUS } from "@/features/presence/status";
import type { Member } from "@/features/profile/api";
import { initials } from "@/features/profile/team-tree";
import type { Role } from "@/lib/api/client";

import { useChangeRole, useCreateInvite, useInvites, useRemoveMember, useRevokeInvite } from "./api";

const ROLE_HINT: Record<Role, string> = {
  owner: "Everything, including inviting people and managing roles",
  editor: "Add data, build dashboards, assign tasks",
  viewer: "View dashboards; move tasks assigned to them",
};
const selectClass = "h-9 rounded-md border border-input bg-transparent px-2 text-sm text-text";
const inviteUrl = (token: string) => (typeof window === "undefined" ? "" : `${window.location.origin}/invite/${token}`);

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

function InviteDialog() {
  const create = useCreateInvite();
  const [role, setRole] = useState<Role>("editor");
  const [email, setEmail] = useState("");

  return (
    <Dialog onOpenChange={(o) => o && (create.reset(), setEmail(""), setRole("editor"))}>
      <DialogTrigger render={<Button />}>
        <UserPlus /> Invite people
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to your workspace</DialogTitle>
          <DialogDescription>Create a link and send it however you like. It works once and expires in 7 days.</DialogDescription>
        </DialogHeader>
        {create.data ? (
          <div className="flex flex-col gap-3">
            <Input readOnly value={inviteUrl(create.data.token)} aria-label="Invite link" onFocus={(e) => e.target.select()} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-faint">Joins as {create.data.role}</span>
              <CopyButton text={inviteUrl(create.data.token)} />
            </div>
            <Button type="button" variant="ghost" onClick={() => create.reset()}>
              Create another
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ role, email: email.trim() || null });
            }}
          >
            <Field>
              <FieldLabel htmlFor="inv-role">Role</FieldLabel>
              <select id="inv-role" className={`${selectClass} w-full`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(["editor", "viewer", "owner"] as Role[]).map((r) => (
                  <option key={r} value={r} className="bg-surface">
                    {r[0].toUpperCase() + r.slice(1)} — {ROLE_HINT[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="inv-email">Their email (optional)</FieldLabel>
              <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" />
              <FieldDescription>Just for your own record of who the link is for. Emails aren&apos;t sent yet.</FieldDescription>
            </Field>
            {create.isError && <p className="text-[13px] text-accent">{create.error.message}</p>}
            <Button type="submit" disabled={create.isPending}>
              <Link2 /> {create.isPending ? "Creating…" : "Create invite link"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MembersPanel({ members, meId, isOwner }: { members: Member[]; meId: string; isOwner: boolean }) {
  const invites = useInvites(isOwner);
  const revoke = useRevokeInvite();
  const changeRole = useChangeRole();
  const remove = useRemoveMember();
  const error = changeRole.error?.message ?? remove.error?.message;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {members.length} {members.length === 1 ? "person" : "people"} in this workspace
        </p>
        {isOwner && <InviteDialog />}
      </div>
      {error && <p className="text-[13px] text-accent">{error}</p>}
      <ul className="flex flex-col divide-y divide-line rounded-[16px] border border-line">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <PresenceAvatar initials={initials(m.name)} status={m.status} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">
                {m.name}
                {m.id === meId && <span className="font-normal text-faint"> (you)</span>}
              </span>
              <span className="truncate text-[13px] text-muted">
                {m.status === "on_leave" && m.leave_type
                  ? `${LEAVE_LABEL[m.leave_type]}${m.leave_until ? ` until ${format(parseISO(m.leave_until), "MMM d")}` : ""} · backup: ${m.backup_name ?? "—"}`
                  : `${STATUS[m.status]?.label ?? "Available"}${m.job_role ? ` · ${m.job_role}` : ""}`}
              </span>
            </div>
            {isOwner && m.id !== meId ? (
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Role of ${m.name}`}
                  className={selectClass}
                  value={m.role}
                  disabled={changeRole.isPending}
                  onChange={(e) => changeRole.mutate({ userId: m.id, role: e.target.value as Role })}
                >
                  {(["owner", "editor", "viewer"] as Role[]).map((r) => (
                    <option key={r} value={r} className="bg-surface">
                      {r[0].toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${m.name}`}
                  onClick={() => window.confirm(`Remove ${m.name} from the workspace? Their tasks become unassigned.`) && remove.mutate(m.id)}
                >
                  <UserMinus />
                </Button>
              </div>
            ) : (
              <span className="rounded-full border border-line px-2.5 py-0.5 text-xs capitalize text-muted">{m.role}</span>
            )}
          </li>
        ))}
      </ul>

      {isOwner && !!invites.data?.length && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Pending invites</h3>
          <ul className="flex flex-col divide-y divide-line rounded-[16px] border border-line">
            {invites.data.map((i) => (
              <li key={i.token} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1">
                  {i.email ?? "Anyone with the link"} · <span className="capitalize">{i.role}</span>
                  <span className="text-faint"> · expires {formatDistanceToNow(new Date(i.expires_at), { addSuffix: true })}</span>
                </span>
                <CopyButton text={inviteUrl(i.token)} />
                <Button variant="ghost" size="icon-sm" aria-label="Revoke invite" onClick={() => revoke.mutate(i.token)}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
