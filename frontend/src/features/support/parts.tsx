"use client";

import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { STATUS_LABEL, type Message, type TicketStatus } from "./api";

const STATUS_VARIANT = {
  open: "info-light",
  pending: "warning-light",
  resolved: "success-light",
  closed: "invert-light",
} as const;

export function StatusBadge({ status, staff }: { status: TicketStatus; staff?: boolean }) {
  // Staff read the same states from their side of the desk.
  const label = staff ? { open: "Open", pending: "Waiting on customer", resolved: "Resolved", closed: "Closed" }[status] : STATUS_LABEL[status];
  return (
    <Badge variant={STATUS_VARIANT[status]} radius="full" size="lg">
      {label}
    </Badge>
  );
}

export function ago(iso: string) {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

/** The conversation, oldest first. Staff see internal notes highlighted; customers never receive them. */
export function Thread({ messages }: { messages: Message[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {messages.map((m) => (
        <li
          key={m.id}
          className={cn(
            "max-w-full rounded-2xl border p-4 sm:max-w-[88%] sm:p-5",
            m.internal
              ? "border-warning/40 bg-warning/5 sm:ml-auto"
              : m.is_staff
                ? "rounded-tr-md border-primary/30 bg-primary/[0.07] sm:ml-auto"
                : "rounded-tl-md border-line bg-surface",
          )}
        >
          <p className="mb-2 flex flex-wrap items-center gap-x-2 text-[13px] text-faint">
            <span className={cn("font-medium", m.is_staff && !m.internal ? "text-highlight" : "text-text")}>
              {m.author_name || (m.is_staff ? "Vyuham support" : "You")}
            </span>
            {m.is_staff && !m.internal && <span>· Vyuham support</span>}
            {m.internal && <span className="font-medium text-warning">· Internal note</span>}
            <span>· {ago(m.created_at)}</span>
          </p>
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text">{m.body}</p>
        </li>
      ))}
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
  onSend: (body: string) => Promise<unknown>;
  pending: boolean;
  error?: string | null;
  placeholder?: string;
  /** Controls next to the send button (staff: "internal note"). */
  extra?: React.ReactNode;
}) {
  const [body, setBody] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        try {
          await onSend(body.trim());
          setBody("");
        } catch {
          /* shown through `error` */
        }
      }}
    >
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} rows={4} maxLength={10_000} aria-label="Reply" />
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>{extra}</div>
        <Button type="submit" disabled={pending || !body.trim()}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
