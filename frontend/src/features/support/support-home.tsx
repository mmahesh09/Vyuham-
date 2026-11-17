"use client";

import { Activity, ArrowRight, BookOpen, ChevronRight, LifeBuoy, Plus } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageContainer } from "@/components/app/page-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/features/auth/hooks";

import { CATEGORY_LABEL, useMyTickets } from "./api";
import { ago, StatusBadge } from "./parts";

const SHORTCUTS = [
  { href: "/help", icon: BookOpen, title: "Help center", text: "Answers to common questions" },
  { href: "/status", icon: Activity, title: "System status", text: "Is everything running?" },
  { href: "/support-center", icon: LifeBuoy, title: "Support center", text: "Topics, guides and contact" },
];

export function SupportHome() {
  const { data: tickets, isLoading, error } = useMyTickets();
  const { data: me } = useMe();
  const open = tickets?.filter((t) => t.status === "open" || t.status === "pending").length ?? 0;

  return (
    <PageContainer width="narrow">
      {/* Header card, in the same style as the public support center */}
      <section className="relative isolate overflow-hidden rounded-[20px] border border-line bg-surface p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -right-16 -top-24 -z-10 size-[320px] rounded-full bg-primary/20 blur-[90px]"
          aria-hidden
        />
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex max-w-[52ch] flex-col gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Help &amp; support</p>
            <h1 className="type-page-title text-text">How can we help?</h1>
            <p className="text-[15px] leading-relaxed text-muted">
              Ask us anything, or tell us what broke. Requests from your whole workspace are listed here, and a person on
              the team reads every one.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {me?.is_staff && (
              <Button variant="outline" nativeButton={false} render={<Link href="/support/admin" />}>
                Support inbox
              </Button>
            )}
            <Button nativeButton={false} render={<Link href="/support/new" />}>
              <Plus aria-hidden /> New request
            </Button>
          </div>
        </div>

        <ul className="mt-7 grid gap-3 sm:grid-cols-3">
          {SHORTCUTS.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="group flex h-full items-center gap-3 rounded-xl border border-line bg-bg/60 p-3.5 transition-colors hover:border-primary/40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-highlight">
                  <s.icon className="size-[18px]" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[14.5px] font-medium text-text">{s.title}</span>
                  <span className="truncate text-[12.5px] text-faint">{s.text}</span>
                </span>
                <ArrowRight className="ml-auto size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-semibold text-text">Your requests</h2>
          {tickets && tickets.length > 0 && (
            <span className="text-[13px] text-faint">
              {open} open · {tickets.length} total
            </span>
          )}
        </div>

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
          <ul className="flex flex-col gap-2.5">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/support/${t.id}`}
                  className="group flex items-center gap-4 rounded-[14px] border border-line bg-surface px-4 py-4 transition-colors hover:border-primary/40 sm:px-5"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="truncate font-medium text-text">{t.subject}</span>
                      <span className="text-[13px] text-faint">
                        {CATEGORY_LABEL[t.category]} · updated {ago(t.updated_at)}
                      </span>
                    </span>
                    <span className="shrink-0">
                      <StatusBadge status={t.status} />
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
