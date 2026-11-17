"use client";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { CATEGORY_LABEL, useReply, useResolve, useTicket } from "./api";
import { ago, ReplyBox, StatusBadge, Thread } from "./parts";

export function TicketScreen({ id }: { id: string }) {
  const { data: t, isLoading, error } = useTicket(id);
  const reply = useReply(id);
  const resolve = useResolve(id);

  if (isLoading) return <Skeleton className="mx-auto h-64 w-full max-w-[960px] rounded-xl" />;
  if (error || !t)
    return (
      <PageContainer width="narrow">
        <PageHeader back={{ href: "/support", label: "Help & support" }} title="Request not found" />
      </PageContainer>
    );

  const done = t.status === "resolved" || t.status === "closed";
  return (
    <PageContainer width="narrow">
      <PageHeader
        back={{ href: "/support", label: "Help & support" }}
        crumb={t.subject}
        title={<h1 className="type-page-title text-text">{t.subject}</h1>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} />
            <span className="text-[13px] text-faint">
              {CATEGORY_LABEL[t.category]} · opened {ago(t.created_at)}
            </span>
          </span>
        }
        actions={
          !done && (
            <Button variant="outline" onClick={() => resolve.mutate()} disabled={resolve.isPending}>
              Mark as solved
            </Button>
          )
        }
      />
      <Thread messages={t.messages} />
      {t.status === "closed" ? (
        <p className="text-[14px] text-muted">This request is closed. Start a new one if you still need help.</p>
      ) : (
        <ReplyBox
          onSend={(body) => reply.mutateAsync(body)}
          pending={reply.isPending}
          error={reply.error?.message}
          placeholder={done ? "Reply to reopen this request…" : "Add more detail or reply to support…"}
        />
      )}
    </PageContainer>
  );
}
