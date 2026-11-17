"use client";

import { Bug, ExternalLink } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Badge } from "@/components/reui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";

import { AdminNav } from "./admin-nav";
import { useArticles, useErrorGroups, usePatchError, type ErrorGroup } from "./api";
import { ago } from "./parts";

const STATUS_VARIANT = { new: "destructive-light", known: "warning-light", fixed: "success-light" } as const;

export function AdminErrors() {
  const { data: groups, isLoading } = useErrorGroups();
  const { data: articles } = useArticles();
  const patch = usePatchError();

  return (
    <PageContainer>
      <PageHeader
        title="Errors"
        description="New issues from GlitchTip. Link each one to a help article: people who hit the same error see the fix on the error screen, and the API's error response points to it."
      />
      <AdminNav />
      {isLoading ? (
        <Skeleton className="h-60 rounded-xl" />
      ) : !groups?.length ? (
        <EmptyState
          icon={<Bug />}
          title="No errors reported yet"
          description="Set SENTRY_DSN and add the GlitchTip webhook (see DEPLOY.md). New issues show up here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g: ErrorGroup) => (
            <Panel key={g.id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="break-words font-mono text-[13.5px] text-text">{g.title}</p>
                  <p className="text-[12.5px] text-faint">
                    {g.culprit && <span className="font-mono">{g.culprit} · </span>}
                    first seen {ago(g.first_seen)} · last {ago(g.last_seen)} · {g.count} alert{g.count === 1 ? "" : "s"}
                    {g.ticket_count > 0 && ` · ${g.ticket_count} ticket${g.ticket_count === 1 ? "" : "s"}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[g.status]} radius="full" size="lg">
                    {g.status}
                  </Badge>
                  {g.url && (
                    <a href={g.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-highlight hover:underline">
                      GlitchTip <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <NativeSelect
                  size="sm"
                  aria-label="Help article"
                  value={g.kb_article_id ?? ""}
                  onChange={(e) => patch.mutate({ id: g.id, kb_article_id: e.target.value || null })}
                >
                  <NativeSelectOption value="">No help article yet</NativeSelectOption>
                  {articles?.map((a) => (
                    <NativeSelectOption key={a.id} value={a.id}>
                      {a.status === "draft" ? "(draft) " : ""}
                      {a.title.slice(0, 70)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <NativeSelect size="sm" aria-label="Status" value={g.status} onChange={(e) => patch.mutate({ id: g.id, status: e.target.value as ErrorGroup["status"] })}>
                  <NativeSelectOption value="new">New</NativeSelectOption>
                  <NativeSelectOption value="known">Known</NativeSelectOption>
                  <NativeSelectOption value="fixed">Fixed</NativeSelectOption>
                </NativeSelect>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
