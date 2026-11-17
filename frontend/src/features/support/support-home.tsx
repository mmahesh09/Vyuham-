"use client";

import { BookOpen, LifeBuoy, Plus } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Panel, PanelRow } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/features/auth/hooks";

import { CATEGORY_LABEL, useMyTickets } from "./api";
import { ago, StatusBadge } from "./parts";

export function SupportHome() {
  const { data: tickets, isLoading, error } = useMyTickets();
  const { data: me } = useMe();
  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Help & support"
        description="Ask us anything, or tell us what broke. Requests from your whole workspace are listed here."
        actions={
          <>
            {me?.is_staff && (
              <Button variant="outline" nativeButton={false} render={<Link href="/support/admin" />}>
                Support inbox
              </Button>
            )}
            <Button variant="outline" nativeButton={false} render={<Link href="/help" />}>
              <BookOpen aria-hidden /> Help center
            </Button>
            <Button nativeButton={false} render={<Link href="/support/new" />}>
              <Plus aria-hidden /> New request
            </Button>
          </>
        }
      />

      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : error ? (
        <p role="alert" className="text-destructive">
          {error.message}
        </p>
      ) : !tickets?.length ? (
        <EmptyState
          icon={<LifeBuoy />}
          title="No requests yet"
          description="Most answers are already in the help center. If yours isn't, we usually reply within one working day."
          action={<Button nativeButton={false} render={<Link href="/support/new" />}>Ask a question</Button>}
        />
      ) : (
        <Panel variant="list">
          {tickets.map((t) => (
            <PanelRow key={t.id} interactive className="p-0">
              <Link href={`/support/${t.id}`} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium text-text">{t.subject}</span>
                  <span className="text-[13px] text-faint">
                    {CATEGORY_LABEL[t.category]} · updated {ago(t.updated_at)}
                  </span>
                </span>
                <StatusBadge status={t.status} />
              </Link>
            </PanelRow>
          ))}
        </Panel>
      )}
    </PageContainer>
  );
}
