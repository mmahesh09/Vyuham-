"use client";

import { format, parseISO } from "date-fns";
import { useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Member } from "@/features/profile/api";
import { cn } from "@/lib/utils";

import { useLeaves, usePresence, useSetPresence, type LeaveType, type PresenceStatus } from "./api";
import { LEAVE_LABEL, MENU_STATUSES, STATUS, StatusDot } from "./status";

const today = () => format(new Date(), "yyyy-MM-dd");
const OTHER = "__other__";

/**
 * Status + leave (profile page). Leave needs a type (sick / casual / paid), dates and a backup —
 * a teammate, or a named person outside the workspace. Every leave is kept in the history below.
 */
export function StatusCard({ meId, members }: { meId: string; members: Member[] }) {
  const presence = usePresence();
  const leaves = useLeaves();
  const set = useSetPresence();
  const current = presence.data;

  const [message, setMessage] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const teammates = members.filter((m) => m.id !== meId);
  const [backup, setBackup] = useState<string>("");
  const [backupName, setBackupName] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  if (!current) return <div className="h-40 animate-pulse rounded-lg bg-line/40" />;
  const msg = message ?? current.message ?? "";
  const showLeaveForm = leaveOpen;

  const setStatus = (status: PresenceStatus) => set.mutate({ status, message: msg || null });

  const openLeaveForm = () => {
    const l = current.leave;
    if (l) {
      setLeaveType(l.leave_type);
      setStart(l.start_date);
      setEnd(l.end_date);
      setBackup(l.backup_user_id ?? (l.backup_name ? OTHER : ""));
      setBackupName(l.backup_user_id ? "" : (l.backup_name ?? ""));
      setNote(l.note ?? "");
    } else if (!backup) {
      setBackup(teammates[0]?.id ?? OTHER);
    }
    setFormError(null);
    setLeaveOpen(true);
  };

  const submitLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (end < start) return setFormError("The leave can't end before it starts.");
    const outside = backup === OTHER || !backup;
    if (outside && !backupName.trim()) return setFormError("Name the person covering for you.");
    setFormError(null);
    set.mutate(
      {
        status: "on_leave",
        message: msg || null,
        leave: {
          leave_type: leaveType,
          start_date: start,
          end_date: end,
          backup_user_id: outside ? null : backup,
          backup_name: outside ? backupName.trim() : null,
          note: note.trim() || null,
        },
      },
      { onSuccess: () => setLeaveOpen(false) },
    );
  };

  return (
    <div id="status" className="flex scroll-mt-6 flex-col gap-5">
      {/* Current status */}
      <div className="flex items-start gap-3 rounded-xl border border-line bg-bg/40 p-3.5">
        <StatusDot status={current.status} className="mt-0.5 size-4" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-semibold">{STATUS[current.status].label}</span>
          {current.status === "on_leave" && current.leave ? (
            <span className="text-xs text-muted">
              {LEAVE_LABEL[current.leave.leave_type]} · {format(parseISO(current.leave.start_date), "MMM d")} –{" "}
              {format(parseISO(current.leave.end_date), "MMM d, yyyy")} · <strong className="text-text">{current.leave.backup_name}</strong> is
              covering
            </span>
          ) : (
            <span className="text-xs text-muted">{STATUS[current.status].hint}</span>
          )}
        </div>
      </div>

      {/* Quick statuses */}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Set status">
        {MENU_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            disabled={set.isPending}
            aria-pressed={current.status === s}
            className={cn(
              "flex min-h-10 items-center gap-2 rounded-lg border border-line px-2.5 text-left text-[13px] transition-colors hover:bg-surface-2 disabled:opacity-60",
              current.status === s && "border-primary bg-line/50 font-semibold",
            )}
          >
            <StatusDot status={s} />
            {STATUS[s].label}
          </button>
        ))}
        <button
          type="button"
          onClick={openLeaveForm}
          aria-expanded={showLeaveForm}
          className={cn(
            "col-span-2 flex min-h-10 items-center gap-2 rounded-lg border border-line px-2.5 text-left text-[13px] hover:bg-surface-2",
            current.status === "on_leave" && "border-primary bg-line/50 font-semibold",
          )}
        >
          <StatusDot status="on_leave" />
          {current.status === "on_leave" ? "On leave — change details" : "I'm on leave…"}
        </button>
      </div>

      <Field>
        <FieldLabel htmlFor="status-message">Status message</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="status-message"
            value={msg}
            maxLength={280}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Closing the books — reply by 4pm"
          />
          <Button
            type="button"
            variant="outline"
            disabled={set.isPending || msg === (current.message ?? "")}
            onClick={() => set.mutate({ status: current.status, message: msg || null })}
          >
            Set
          </Button>
        </div>
      </Field>

      {/* Leave form */}
      {showLeaveForm && (
        <form onSubmit={submitLeave} className="flex flex-col gap-4 rounded-xl border border-primary/60 bg-line/20 p-4" aria-label="Leave details">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field className="sm:col-span-3">
              <FieldLabel htmlFor="leave-type">Leave type</FieldLabel>
              <NativeSelect id="leave-type" value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)} className="w-full">
                {(Object.keys(LEAVE_LABEL) as LeaveType[]).map((t) => (
                  <option key={t} value={t} className="bg-surface">
                    {LEAVE_LABEL[t]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field className="sm:col-span-3 sm:grid sm:grid-cols-2 sm:gap-4">
              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="leave-start">From</FieldLabel>
                <Input id="leave-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required className="[color-scheme:dark]" />
              </div>
              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="leave-end">Until (inclusive)</FieldLabel>
                <Input id="leave-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required className="[color-scheme:dark]" />
              </div>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="leave-backup">
              Backup while you&apos;re away <span className="text-accent" aria-hidden>*</span>
            </FieldLabel>
            <NativeSelect id="leave-backup" value={backup || OTHER} onChange={(e) => setBackup(e.target.value)} className="w-full">
              {teammates.map((m) => (
                <option key={m.id} value={m.id} className="bg-surface">
                  {m.name}
                  {m.job_role ? ` — ${m.job_role}` : ""}
                </option>
              ))}
              <option value={OTHER} className="bg-surface">
                Someone outside this workspace…
              </option>
            </NativeSelect>
            {(backup === OTHER || !backup) && (
              <Input
                aria-label="Backup person's name"
                value={backupName}
                maxLength={200}
                onChange={(e) => setBackupName(e.target.value)}
                placeholder="Name and how to reach them, e.g. Priya — priya@agency.com"
              />
            )}
            {teammates.length === 0 && <p className="text-xs text-faint">Invite teammates to pick them as your backup.</p>}
          </Field>
          <Field>
            <FieldLabel htmlFor="leave-note">Handover note</FieldLabel>
            <Textarea id="leave-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should your backup keep an eye on?" />
          </Field>
          {(formError || set.isError) && <p className="text-[13px] text-accent">{formError ?? set.error?.message}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setLeaveOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={set.isPending}>
              {set.isPending ? "Saving…" : current.status === "on_leave" ? "Update leave" : "Start leave"}
            </Button>
          </div>
        </form>
      )}

      {/* History */}
      {leaves.data && leaves.data.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Leave history</h3>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {leaves.data.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
                <span className="flex flex-col">
                  <span className="font-medium">{LEAVE_LABEL[l.leave_type]}</span>
                  <span className="text-xs text-muted">
                    {format(parseISO(l.start_date), "MMM d")} – {format(parseISO(l.end_date), "MMM d, yyyy")} · backup {l.backup_name ?? "—"}
                  </span>
                </span>
                <Badge variant={l.status === "active" ? "success-light" : l.status === "cancelled" ? "destructive-light" : "outline"}>
                  {l.status}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
