"use client";

import { format } from "date-fns";

import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
} from "@/components/reui/timeline";
import { cn } from "@/lib/utils";

import type { Activity } from "./api";

const DOT: Record<Activity["kind"], string> = {
  dataset: "bg-highlight",
  member: "bg-primary",
  profile: "bg-accent",
  leave: "bg-[#ffaa44]",
};

/** Recent workspace changes, newest first (ReUI c-timeline-7). */
export function ActivityTimeline({ items }: { items: Activity[] }) {
  if (items.length === 0) return <p className="text-sm text-muted">Nothing has happened in this workspace yet.</p>;
  return (
    <Timeline defaultValue={items.length} className="gap-3">
      {items.map((item, index) => (
        <TimelineItem key={item.id} step={index + 1} className="group-data-[orientation=vertical]/timeline:not-last:pb-0">
          <TimelineHeader className="flex items-center gap-2.5">
            <TimelineSeparator />
            <TimelineIndicator className={cn("size-2 border-none", DOT[item.kind])} />
            <TimelineDate className="mb-0 text-[10px] font-semibold uppercase tracking-wide text-faint">
              {format(new Date(item.at), "MMM d, yyyy · h:mm a")}
            </TimelineDate>
          </TimelineHeader>
          <TimelineContent className="text-sm text-text">
            <span className="font-medium">{item.actor}</span> <span className="text-muted">{item.title.toLowerCase()}</span>
            <span className="block truncate text-xs text-faint">{item.detail}</span>
          </TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  );
}
