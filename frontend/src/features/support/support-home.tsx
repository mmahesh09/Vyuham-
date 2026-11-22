"use client";

import { Activity, ArrowRight, BookOpen, Inbox, LifeBuoy, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageContainer } from "@/components/app/page-container";
import { SegmentedControl } from "@/components/app/segmented-control";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/features/auth/hooks";
import { HelpSearch } from "@/features/help/help-search";

import { requestState, useMyTickets, type Ticket } from "./api";
import { RequestRow } from "./parts";

const SHORTCUTS = [
  { href: "/help", icon: BookOpen, title: "Help center", text: "Guides and answers" },
  { href: "/status", icon: Activity, title: "System status", text: "Is everything running?" },
  { href: "/support-center", icon: LifeBuoy, title: "Support center", text: "Topics and popular articles" },
];

type Filter = "waiting" | "active" | "resolved" | "all";
const FILTERS: { value: Filter; label: string; match: (t: Ticket) => boolean }[] = [
  { value: "active", label: "Active", match: (t) => t.status === "open" || t.status === "pending" },
  { value: "waiting", label: "Waiting on you", match: (t) => requestState(t) === "waiting" },
  { value: "resolved", label: "Resolved", match: (t) => t.status === "resolved" || t.status === "closed" },
  { value: "all", label: "All", match: () => true },
];
const EMPTY: Record<Filter, string> = {
  waiting: "Nothing needs your reply right now.",
  active: "No open requests. Everything you've asked about has been wrapped up.",
  resolved: "No resolved requests yet.",
  all: "No requests yet.",
};

function firstName(name: string | undefined) {
  return name?.trim().split(/\s+/)[0] || "";
}

export function SupportHome() {
  const { data: tickets, isLoading, error, refetch } = useMyTickets();
  const { data: me } = useMe();
  const [picked, setPicked] = useState<Filter | null>(null);
  const [q, setQ] = useState("");

  const list = tickets ?? [];
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, list.filter(f.match).length])) as Record<Filter, number>;
  // Until someone picks a tab, start where attention is needed.
  const filter: Filter = picked ?? (counts.waiting > 0 ? "waiting" : counts.active > 0 ? "active" : "all");
  const term = q.trim().toLowerCase();
  const shown = list
    .filter(FILTERS.find((f) => f.value === filter)!.match)
    .filter((t) => !term || t.subject.toLowerCase().includes(term) || t.id.startsWith(term));
  const name = firstName(me?.name);

  return (
    <PageContainer width="narrow">
      <section className="relative isolate overflow-hidden rounded-[20px] border border-line bg-surface p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 -z-10 size-[320px] rounded-full bg-primary/20 blur-[90px]" aria-hidden />
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex max-w-[52ch] flex-col gap-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Help &amp; support</p>
              <h1 className="type-page-title text-text">{name ? `Hi ${name}, how can we help?` : "How can we help?"}</h1>
              <p className="text-[15px] leading-relaxed text-muted">
                Search the guides, or send us a request. A person on the team reads every one and replies here and by email.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {me?.is_staff && (
                <Button variant="outline" nativeButton={false} render={<Link href="/support/admin" />}>
                  <Inbox aria-hidden /> Support inbox
                </Button>
              )}
              <Button nativeButton={false} render={<Link href="/support/new" />}>
                <Plus aria-hidden /> New request
              </Button>
            </div>
          </div>
          <HelpSearch />
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="requests-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="requests-title" className="text-[17px] font-semibold text-text">
            Your requests
          </h2>
          {list.length > 0 && (
            <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 focus-within:border-highlight sm:w-[240px]">
              <Search className="size-4 shrink-0 text-faint" aria-hidden />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search subject or ID"
                aria-label="Search your requests"
                className="w-full min-w-0 bg-transparent text-[14px] text-text outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
              />
              {q && (
                <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="text-faint hover:text-text">
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </label>
          )}
        </div>

        {list.length > 0 && (
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <SegmentedControl
              label="Filter requests"
              value={filter}
              onChange={setPicked}
              className="w-max"
              options={FILTERS.map((f) => ({
                value: f.value,
                label: (
                  <>
                    {f.label}
                    <span className={f.value === "waiting" && counts.waiting > 0 ? "text-warning" : "text-faint"}>{counts[f.value]}</span>
                  </>
                ),
              }))}
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Loading your requests">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[88px] rounded-[14px]" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-surface p-5">
            <p className="text-[14.5px] text-text">We couldn&apos;t load your requests. {error.message}</p>
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<LifeBuoy />}
            title="No requests yet"
            description="Most answers are already in the help center. If yours isn't, send a request and a person on the team will reply here and by email."
            action={
              <Button nativeButton={false} render={<Link href="/support/new" />}>
                Ask a question
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-line-strong px-5 py-8 text-center text-[14.5px] text-muted">
            {term ? `No requests match “${q.trim()}”.` : EMPTY[filter]}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5" aria-live="polite">
            {shown.map((t) => (
              <RequestRow key={t.id} t={t} />
            ))}
          </ul>
        )}
      </section>

      <nav aria-label="More help" className="grid gap-3 sm:grid-cols-3">
        {SHORTCUTS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface p-3.5 transition-colors hover:border-primary/40"
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
        ))}
      </nav>
    </PageContainer>
  );
}
