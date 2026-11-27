"use client";

import { BookPlus, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";

import { AdminNav } from "./admin-nav";
import { CATEGORY_LABEL, useErrorGroups, usePatchTicket, useStaffReply, useStaffTicket, useTicketToArticle, type Priority, type TicketStatus } from "./api";
import { ago, ReplyBox, StatusBadge, Thread } from "./parts";

const STATUSES: TicketStatus[] = ["open", "pending", "resolved", "closed"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

export function AdminTicket({ id }: { id: string }) {
  const router = useRouter();
  const { data: t, isLoading } = useStaffTicket(id);
  const reply = useStaffReply(id);
  const patch = usePatchTicket(id);
  const toArticle = useTicketToArticle(id);
  const { data: errors } = useErrorGroups();
  const [internal, setInternal] = useState(false);

  if (isLoading || !t) return <Skeleton className="mx-auto h-72 w-full max-w-[1240px] rounded-xl" />;

  return (
    <PageContainer width="medium">
      <PageHeader back={{ href: "/support/admin", label: "Support inbox" }} crumb={t.subject} title={t.subject} />
      <AdminNav />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Thread messages={t.messages} />
          <ReplyBox
            onSend={(body, attachment_ids) => reply.mutateAsync({ body, internal, attachment_ids })}
            pending={reply.isPending}
            error={reply.error?.message}
            placeholder={internal ? "Internal note (the customer won't see this)…" : "Reply to the customer (they get an email)…"}
            extra={
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <Checkbox checked={internal} onCheckedChange={(v) => setInternal(!!v)} /> Internal note
              </label>
            }
          />
        </div>

        <aside className="flex flex-col gap-4">
          <Panel className="flex flex-col gap-3 text-[14px]">
            <StatusBadge status={t.status} staff />
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
              <dt className="text-faint">From</dt>
              <dd className="truncate text-text">
                {t.requester_name} <span className="text-faint">{t.requester_email}</span>
              </dd>
              <dt className="text-faint">Workspace</dt>
              <dd className="text-text">{t.workspace_name}</dd>
              <dt className="text-faint">Type</dt>
              <dd className="text-text">{CATEGORY_LABEL[t.category]}</dd>
              <dt className="text-faint">Opened</dt>
              <dd className="text-text">{ago(t.created_at)}</dd>
              {t.page_url && (
                <>
                  <dt className="text-faint">Page</dt>
                  <dd className="truncate font-mono text-[12px] text-text">{t.page_url}</dd>
                </>
              )}
              {t.error_event_id && (
                <>
                  <dt className="text-faint">Error ref</dt>
                  <dd className="truncate font-mono text-[12px] text-text">{t.error_event_id}</dd>
                </>
              )}
            </dl>
          </Panel>

          <Panel className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[13px] text-faint">
              Status
              <NativeSelect value={t.status} onChange={(e) => patch.mutate({ status: e.target.value as TicketStatus })} className="w-full">
                {STATUSES.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {s}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-[13px] text-faint">
              Priority
              <NativeSelect value={t.priority} onChange={(e) => patch.mutate({ priority: e.target.value as Priority })} className="w-full">
                {PRIORITIES.map((p) => (
                  <NativeSelectOption key={p} value={p}>
                    {p}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-[13px] text-faint">
              Linked error
              <NativeSelect
                value={t.error_group_id ?? ""}
                onChange={(e) => patch.mutate({ error_group_id: e.target.value || null })}
                className="w-full"
              >
                <NativeSelectOption value="">None</NativeSelectOption>
                {errors?.map((g) => (
                  <NativeSelectOption key={g.id} value={g.id}>
                    {g.title.slice(0, 60)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            {patch.error && <p className="text-[13px] text-destructive">{patch.error.message}</p>}
          </Panel>

          <Panel className="flex flex-col gap-3">
            <p className="text-[14px] font-medium text-text">Help the next person</p>
            <p className="text-[13px] text-muted">Turn this conversation into a draft help article. Linked errors will point to it once it&apos;s published.</p>
            {t.kb_article_id ? (
              <Button variant="outline" nativeButton={false} render={<Link href={`/support/admin/kb?edit=${t.kb_article_id}`} />}>
                <ExternalLink aria-hidden /> Open the article
              </Button>
            ) : (
              <Button
                onClick={async () => {
                  const a = await toArticle.mutateAsync().catch(() => null);
                  if (a) router.push(`/support/admin/kb?edit=${a.id}`);
                }}
                disabled={toArticle.isPending}
              >
                <BookPlus aria-hidden /> Turn into help article
              </Button>
            )}
          </Panel>
        </aside>
      </div>
    </PageContainer>
  );
}
