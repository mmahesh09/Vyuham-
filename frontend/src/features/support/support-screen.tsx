"use client";

import * as Sentry from "@sentry/nextjs";
import { formatDistanceToNow } from "date-fns";
import { BookOpen, Bug, Check, ExternalLink, MessageCircle, MessagesSquare } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Textarea } from "@/components/ui/textarea";

import { useReportProblem, useSupportConfig, useSupportConversations, type SupportConversation } from "./api";
import { openSupportChat } from "./widget";

const STATUS: Record<SupportConversation["status"], { label: string; variant: "primary-light" | "secondary" }> = {
  open: { label: "Open", variant: "primary-light" },
  pending: { label: "Waiting", variant: "primary-light" },
  snoozed: { label: "Snoozed", variant: "secondary" },
  resolved: { label: "Resolved", variant: "secondary" },
};

function Card({ icon: Icon, title, children }: { icon: typeof BookOpen; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line p-5">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold">
        <Icon className="size-[18px] text-highlight" strokeWidth={1.8} aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

function ChatButton({ label, variant = "default" }: { label: string; variant?: "default" | "outline" }) {
  const [blocked, setBlocked] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <Button variant={variant} className="self-start" onClick={() => setBlocked(!openSupportChat())}>
        <MessageCircle /> {label}
      </Button>
      {blocked && <p className="text-[13px] text-accent">The chat is still loading or was blocked by a browser extension. Try again in a moment, or allow it for this site.</p>}
    </div>
  );
}

function Conversations() {
  const { data, isPending, isError, error } = useSupportConversations(true);
  if (isPending) return <p className="text-sm text-muted">Loading your conversations…</p>;
  if (isError) return <p className="text-sm text-accent">{error.message}</p>;
  if (!data.length) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquare />
          </EmptyMedia>
          <EmptyTitle>No conversations yet</EmptyTitle>
          <EmptyDescription>When you contact support or report a problem, it shows up here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line">
      {data.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">Conversation #{c.id}</span>
              <Badge variant={STATUS[c.status]?.variant ?? "secondary"}>{STATUS[c.status]?.label ?? c.status}</Badge>
              {c.unread_count > 0 && <span className="text-[12px] text-highlight">{c.unread_count} new</span>}
            </div>
            {c.last_message && (
              <p className="truncate text-sm text-muted">
                {c.last_message.from === "you" ? "You: " : "Support: "}
                {c.last_message.text}
              </p>
            )}
            <p className="text-[12px] text-faint">Updated {formatDistanceToNow(new Date(c.last_activity_at * 1000), { addSuffix: true })}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => openSupportChat()}>
            Open
          </Button>
        </li>
      ))}
    </ul>
  );
}

function sameSitePreviousPage(): string | undefined {
  try {
    const ref = new URL(document.referrer);
    return ref.origin === window.location.origin ? ref.pathname : undefined;
  } catch {
    return undefined;
  }
}

function ReportProblem() {
  const [description, setDescription] = useState("");
  const report = useReportProblem();

  if (report.isSuccess) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="flex items-center gap-2 text-sm text-highlight">
          <Check className="size-4" aria-hidden /> Thanks. We opened conversation #{report.data.conversation_id} and will reply there.
        </p>
        <Button variant="outline" className="self-start" onClick={() => (setDescription(""), report.reset())}>
          Report something else
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        report.mutate({
          description: description.trim(),
          page: sameSitePreviousPage(),
          release: process.env.NEXT_PUBLIC_APP_RELEASE || undefined,
          error_id: Sentry.lastEventId() || undefined, // links the report to the GlitchTip error, if one just happened
        });
      }}
    >
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value.slice(0, 4000))}
        placeholder="What happened, and what did you expect? Please don't include passwords or customer data."
        rows={4}
        aria-label="Describe the problem"
      />
      <p className="text-[12px] text-faint">We also attach the page you came from, your browser and the app version, so we can reproduce it.</p>
      {report.isError && <p className="text-[13px] text-accent">{report.error.message}</p>}
      <Button type="submit" className="self-start" disabled={description.trim().length < 10 || report.isPending}>
        <Bug /> {report.isPending ? "Sending…" : "Send report"}
      </Button>
    </form>
  );
}

export function SupportScreen() {
  const { data: config, isPending } = useSupportConfig();
  const helpUrl = config?.help_center_url;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 pt-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[38px] font-semibold tracking-[-0.03em]">Help & Support</h1>
        <p className="text-[15px] text-muted">Chat with us, check on your conversations, read the guides or tell us about a problem.</p>
      </div>

      {isPending ? null : !config?.enabled ? (
        <p className="rounded-2xl border border-line p-5 text-sm text-muted">
          Support chat isn&apos;t set up for this installation yet.
          {helpUrl && " You can still read the help documentation below."}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card icon={MessageCircle} title="Contact support">
            <p className="text-sm text-muted">Start a chat with our team. If you leave, we&apos;ll keep the conversation here and reply by email.</p>
            <ChatButton label="Start a chat" />
          </Card>
          <Card icon={Bug} title="Report a problem">
            {config.can_list_conversations ? <ReportProblem /> : <ChatButton label="Tell us in the chat" variant="outline" />}
          </Card>
          {config.can_list_conversations && (
            <div className="md:col-span-2">
              <Card icon={MessagesSquare} title="Your conversations">
                <Conversations />
              </Card>
            </div>
          )}
        </div>
      )}

      {helpUrl && (
        <Card icon={BookOpen} title="Help documentation">
          <p className="text-sm text-muted">Step-by-step guides and answers to common questions.</p>
          <Button variant="outline" className="self-start" nativeButton={false} render={<a href={helpUrl} target="_blank" rel="noopener noreferrer" />}>
            Open the help center <ExternalLink />
          </Button>
        </Card>
      )}
    </div>
  );
}
