"use client";

import { ArrowRight, BookOpen, CheckCircle2, Circle, CircleCheck, LifeBuoy, MessageSquarePlus } from "lucide-react";
import Link from "next/link";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CATEGORY_LABEL, requestState, useReply, useResolve, useTicket, type TicketDetail } from "./api";
import { ago, ReplyBox, StatusBadge, Thread } from "./parts";
import { CopyId } from "./request-flow";

const card = "rounded-[16px] border border-line bg-surface p-5";
const when = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Timeline({ t }: { t: TicketDetail }) {
  const firstReply = t.messages.find((m) => m.is_staff && !m.internal);
  const steps: { label: string; at: string | null; done: boolean }[] = [
    { label: "Request sent", at: t.created_at, done: true },
    { label: "Support replied", at: firstReply?.created_at ?? null, done: !!firstReply },
    { label: t.status === "closed" ? "Closed" : "Resolved", at: t.resolved_at, done: t.status === "resolved" || t.status === "closed" },
  ];
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex gap-3 pb-4 last:pb-0">
          {i < steps.length - 1 && (
            <span className={cn("absolute left-[9px] top-6 h-[calc(100%-20px)] w-px", s.done ? "bg-primary/40" : "bg-line")} aria-hidden />
          )}
          {s.done ? (
            <CircleCheck className="size-[19px] shrink-0 text-highlight" aria-hidden />
          ) : (
            <Circle className="size-[19px] shrink-0 text-line-strong" aria-hidden />
          )}
          <span className="flex flex-col">
            <span className={cn("text-[14px]", s.done ? "text-text" : "text-faint")}>
              {s.label}
              <span className="sr-only">{s.done ? " (done)" : " (not yet)"}</span>
            </span>
            {s.at && <time className="text-[12.5px] text-faint" dateTime={s.at}>{when.format(new Date(s.at))}</time>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function TicketScreen({ id }: { id: string }) {
  const { data: t, isLoading, error } = useTicket(id);
  const reply = useReply(id);
  const resolve = useResolve(id);

  if (isLoading) return <Skeleton className="mx-auto h-64 w-full max-w-[1240px] rounded-xl" />;
  if (error || !t)
    return (
      <PageContainer width="narrow">
        <PageHeader back={{ href: "/support", label: "Help & support" }} title="Request not found" />
        <p className="text-[15px] text-muted">
          It may belong to another workspace, or the link is incomplete.{" "}
          <Link href="/support" className="text-highlight hover:underline">
            See your requests
          </Link>
          .
        </p>
      </PageContainer>
    );

  const done = t.status === "resolved" || t.status === "closed";
  const state = requestState(t);
  const errorRef = t.error_event_id;

  return (
    <PageContainer width="medium">
      <PageHeader
        back={{ href: "/support", label: "Help & support" }}
        crumb={t.subject}
        title={<h1 className="type-page-title text-text">{t.subject}</h1>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} staffReplied={t.staff_replied} />
            <span className="text-[13px] text-faint">
              {CATEGORY_LABEL[t.category]} · opened {ago(t.created_at)}
            </span>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
        {/* On small screens the details come first, so the status is visible without scrolling the thread. */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:order-2 lg:self-start" aria-label="Request details">
          {state === "waiting" && (
            <div className={`${card} flex flex-col gap-3 border-warning/40 bg-warning/[0.05]`}>
              <p className="flex items-center gap-2 text-[14.5px] font-medium text-text">
                <LifeBuoy className="size-4 text-warning" aria-hidden /> Did that solve it?
              </p>
              <p className="text-[13.5px] leading-relaxed text-muted">
                Support replied and is waiting on you. Reply below if you still need help, or let us know it&apos;s sorted.
              </p>
              <Button variant="outline" onClick={() => resolve.mutate()} disabled={resolve.isPending}>
                <CheckCircle2 aria-hidden /> {resolve.isPending ? "Saving…" : "Yes, it's solved"}
              </Button>
            </div>
          )}

          <div className={`${card} flex flex-col gap-4`}>
            <h2 className="text-[14px] font-semibold text-text">Progress</h2>
            <Timeline t={t} />
          </div>

          <div className={card}>
            <h2 className="mb-3 text-[14px] font-semibold text-text">Details</h2>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13.5px]">
              <dt className="text-faint">Request ID</dt>
              <dd className="-ml-1.5">
                <CopyId id={t.id} />
              </dd>
              <dt className="text-faint">Type</dt>
              <dd className="text-text">{CATEGORY_LABEL[t.category]}</dd>
              <dt className="text-faint">Updated</dt>
              <dd className="text-text">{ago(t.updated_at)}</dd>
              {errorRef && (
                <>
                  <dt className="text-faint">Error ref</dt>
                  <dd className="truncate font-mono text-[12.5px] text-muted" title={errorRef}>
                    {errorRef}
                  </dd>
                </>
              )}
            </dl>
          </div>

          {t.kb_article && (
            <Link
              href={`/help/${t.kb_article.slug}`}
              className={`${card} group flex items-start gap-3 transition-colors hover:border-primary/40`}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-highlight">
                <BookOpen className="size-4" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[12.5px] text-faint">Related article</span>
                <span className="text-[14px] font-medium text-text group-hover:text-highlight">{t.kb_article.title}</span>
              </span>
              <ArrowRight className="ml-auto mt-1 size-4 shrink-0 text-faint" aria-hidden />
            </Link>
          )}

          {!done && state !== "waiting" && (
            <Button variant="ghost" className="justify-start" onClick={() => resolve.mutate()} disabled={resolve.isPending}>
              <CheckCircle2 aria-hidden /> Mark as solved
            </Button>
          )}
        </aside>

        <div className="flex min-w-0 flex-col gap-6 lg:order-1">
          <Thread messages={t.messages} />
          {t.status === "closed" ? (
            <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
              <p className="text-[14px] text-muted">This request is closed. Start a new one if you still need help.</p>
              <Button variant="outline" nativeButton={false} render={<Link href="/support/new" />}>
                <MessageSquarePlus aria-hidden /> New request
              </Button>
            </div>
          ) : (
            <ReplyBox
              onSend={(body, attachment_ids) => reply.mutateAsync({ body, attachment_ids })}
              pending={reply.isPending}
              error={reply.error?.message}
              placeholder={done ? "Reply to reopen this request…" : "Add more detail or reply to support…"}
            />
          )}
        </div>
      </div>
    </PageContainer>
  );
}
