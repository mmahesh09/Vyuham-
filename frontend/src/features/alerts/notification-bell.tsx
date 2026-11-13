"use client";

import { formatDistanceToNow } from "date-fns";
import { Bell, BellRing, CalendarClock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { useMarkRead, useNotifications, useUnreadCount } from "./api";

/** The bell: alerts and digests for you. Opening it marks everything read. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const list = useNotifications(open);
  const markRead = useMarkRead();
  const count = unread.data?.count ?? 0;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && count > 0) markRead.mutate();
      }}
    >
      <PopoverTrigger
        data-tour="bell"
        render={
          <button
            type="button"
            className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted transition-colors hover:border-line-strong hover:text-text"
            aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
          />
        }
      >
        <Bell className="size-4" strokeWidth={1.8} aria-hidden />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-bg">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <Link href="/alerts?tab=history" onClick={() => setOpen(false)} className="text-xs text-highlight hover:underline">
            All history
          </Link>
        </div>
        {!list.data?.length ? (
          <p className="px-3 py-8 text-center text-sm text-faint">{list.isPending ? "Loading…" : "Nothing yet. Alerts and digests will show up here."}</p>
        ) : (
          <ul className="flex max-h-96 flex-col overflow-y-auto">
            {list.data.map((n) => (
              <li key={n.id} className="border-b border-line/60 last:border-b-0">
                <Link href={n.link ?? "/alerts"} onClick={() => setOpen(false)} className="flex gap-2.5 px-3 py-2.5 hover:bg-surface-2">
                  {n.kind === "digest" ? <CalendarClock className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden /> : <BellRing className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className={`text-sm ${n.read_at ? "text-muted" : "font-semibold"}`}>{n.title}</span>
                    <span className="line-clamp-2 whitespace-pre-line text-xs text-muted">{n.body}</span>
                    <span className="text-[11px] text-faint">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
