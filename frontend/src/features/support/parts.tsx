"use client";

import { formatDistanceToNow } from "date-fns";
import { ChevronRight, CornerDownRight, LifeBuoy, Paperclip } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { CATEGORY_LABEL, REQUEST_STATE_LABEL, requestState, type Message, type Ticket, type TicketStatus } from "./api";
import { AttachmentList, AttachmentPicker, useAttachments } from "./attachments";

const STATUS_VARIANT = {
  open: "info-light",
  pending: "warning-light",
  resolved: "success-light",
  closed: "invert-light",
} as const;
const STATE_VARIANT = {
  open: "info-light",
  in_progress: "primary-light",
  waiting: "warning-light",
  resolved: "success-light",
  closed: "invert-light",
} as const;

export function StatusBadge({ status, staff, staffReplied = false }: { status: TicketStatus; staff?: boolean; staffReplied?: boolean }) {
  if (staff) {
    // Staff read the stored states from their side of the desk.
    const label = { open: "Open", pending: "Waiting on customer", resolved: "Resolved", closed: "Closed" }[status];
    return (
      <Badge variant={STATUS_VARIANT[status]} radius="full" size="lg">
        {label}
      </Badge>
    );
  }
  const state = requestState({ status, staff_replied: staffReplied });
  return (
    <Badge variant={STATE_VARIANT[state]} radius="full" size="lg">
      {REQUEST_STATE_LABEL[state]}
    </Badge>
  );
}

export function ago(iso: string) {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

/** One request in a list: subject, status, the latest visible reply. Used in the app and on the public support center. */
export function RequestRow({ t, compact = false }: { t: Ticket; compact?: boolean }) {
  const reply = t.latest_reply;
  const waiting = requestState(t) === "waiting";
  return (
    <li>
      <Link
        href={`/support/${t.id}`}
        className={cn(
          "group relative flex items-center gap-4 overflow-hidden rounded-[14px] border bg-surface transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight",
          compact ? "px-4 py-3" : "px-4 py-4 sm:px-5",
          waiting ? "border-warning/40" : "border-line",
        )}
      >
        {waiting && <span className="absolute inset-y-0 left-0 w-[3px] bg-warning" aria-hidden />}
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[15px] font-medium text-text group-hover:text-highlight">{t.subject}</span>
              <span className="text-[12.5px] text-faint">
                {CATEGORY_LABEL[t.category]} · updated {ago(t.updated_at)}
              </span>
            </span>
            <span className="shrink-0">
              <StatusBadge status={t.status} staffReplied={t.staff_replied} />
            </span>
          </span>
          {!compact && reply && (
            <span className="flex min-w-0 items-start gap-2 text-[13.5px] leading-relaxed">
              <CornerDownRight className="mt-[3px] size-3.5 shrink-0 text-faint" aria-hidden />
              <span className="line-clamp-1 min-w-0">
                <span className={cn("font-medium", reply.is_staff ? "text-highlight" : "text-text")}>
                  {reply.is_staff ? "Vyuham support" : reply.author_name || "You"}:
                </span>{" "}
                <span className="text-muted">{reply.excerpt}</span>
              </span>
            </span>
          )}
        </span>
        <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

/** The conversation, oldest first. Staff see internal notes highlighted; customers never receive them. */
export function Thread({ messages }: { messages: Message[] }) {
  return (
    <ol className="flex flex-col gap-5" aria-label="Conversation">
      {messages.map((m) => {
        const support = m.is_staff && !m.internal;
        const name = m.author_name || (m.is_staff ? "Vyuham support" : "You");
        return (
          <li key={m.id} className="flex gap-3">
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
                m.internal ? "bg-warning/15 text-warning" : support ? "bg-primary/15 text-highlight" : "bg-surface-2 text-muted",
              )}
              aria-hidden
            >
              {support ? <LifeBuoy className="size-4" /> : initials(name)}
            </span>
            <div
              className={cn(
                "min-w-0 flex-1 rounded-2xl rounded-tl-md border p-4 sm:p-5",
                m.internal ? "border-warning/40 bg-warning/5" : support ? "border-primary/30 bg-primary/[0.06]" : "border-line bg-surface",
              )}
            >
              <p className="mb-2 flex flex-wrap items-center gap-x-2 text-[13px] text-faint">
                <span className={cn("font-medium", support ? "text-highlight" : "text-text")}>{name}</span>
                {support && <span>· Vyuham support</span>}
                {m.internal && <span className="font-medium text-warning">· Internal note</span>}
                <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString()}>
                  · {ago(m.created_at)}
                </time>
              </p>
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text">{m.body}</p>
              <AttachmentList attachments={m.attachments} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ReplyBox({
  onSend,
  pending,
  error,
  placeholder = "Write a reply…",
  extra,
}: {
  onSend: (body: string, attachmentIds: string[]) => Promise<unknown>;
  pending: boolean;
  error?: string | null;
  placeholder?: string;
  /** Controls next to the send button (staff: "internal note"). */
  extra?: React.ReactNode;
}) {
  const [body, setBody] = useState("");
  const files = useAttachments();
  const [showFiles, setShowFiles] = useState(false);
  const busy = pending || files.uploading;

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3 focus-within:border-line-strong sm:p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim() || busy) return;
        try {
          await onSend(body.trim(), files.ids);
          setBody("");
          files.reset();
          setShowFiles(false);
        } catch {
          /* shown through `error` */
        }
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onPaste={(e) => {
          if (e.clipboardData.files.length) setShowFiles(true);
          files.onPaste(e);
        }}
        placeholder={placeholder}
        rows={4}
        maxLength={10_000}
        aria-label="Reply"
        className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
      />
      {(showFiles || files.items.length > 0) && <AttachmentPicker state={files} compact />}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <div className="flex flex-wrap items-center gap-3">
          {!showFiles && files.items.length === 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowFiles(true)}>
              <Paperclip aria-hidden /> Attach
            </Button>
          )}
          {extra}
        </div>
        <Button type="submit" disabled={busy || !body.trim() || files.failed}>
          {pending ? "Sending…" : files.uploading ? "Uploading…" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
