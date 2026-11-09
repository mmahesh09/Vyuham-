"use client";

import { ArrowLeft, Check, Clock, Minus, Plane, X } from "lucide-react";
import type { ComponentType } from "react";

import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import type { LeaveType, PresenceStatus } from "./api";

type StatusMeta = { label: string; badge: string; icon: ComponentType<{ className?: string; strokeWidth?: number }> | null; hint: string };

/** Microsoft Teams-style presence (ReUI c-avatar-7 badge). */
export const STATUS: Record<PresenceStatus | "offline", StatusMeta> = {
  available: { label: "Available", badge: "bg-[#6bb700] text-[#05040a]", icon: Check, hint: "Free to chat" },
  busy: { label: "Busy", badge: "bg-[#c4314b]", icon: null, hint: "In focus or in a meeting" },
  dnd: { label: "Do not disturb", badge: "bg-[#c4314b] text-text", icon: Minus, hint: "Only urgent alerts" },
  away: { label: "Away", badge: "bg-[#ffaa44] text-[#05040a]", icon: Clock, hint: "Back soon" },
  out_of_office: { label: "Out of office", badge: "bg-[#b4009e] text-text", icon: ArrowLeft, hint: "Not working today" },
  on_leave: { label: "On leave", badge: "bg-primary text-text", icon: Plane, hint: "Sick, casual or paid leave" },
  appear_offline: { label: "Appear offline", badge: "bg-bg ring-[1.5px]! ring-faint! text-faint", icon: X, hint: "Teammates see you as offline" },
  offline: { label: "Offline", badge: "bg-bg ring-[1.5px]! ring-faint! text-faint", icon: X, hint: "" },
};

/** Order in the status menu. */
export const MENU_STATUSES: PresenceStatus[] = ["available", "busy", "dnd", "away", "out_of_office", "appear_offline"];

export const LEAVE_LABEL: Record<LeaveType, string> = { sick: "Sick leave", casual: "Casual leave", paid: "Paid leave" };

export function StatusDot({ status, className }: { status: PresenceStatus | "offline"; className?: string }) {
  const meta = STATUS[status] ?? STATUS.available;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex size-3.5 shrink-0 items-center justify-center rounded-full", meta.badge, className)} aria-hidden>
      {Icon && <Icon className="size-2.5" strokeWidth={3} />}
    </span>
  );
}

export function PresenceAvatar({
  initials,
  status,
  size = "default",
  className,
  fallbackClassName,
}: {
  initials: string;
  status: PresenceStatus | "offline";
  size?: "sm" | "default" | "lg";
  className?: string;
  fallbackClassName?: string;
}) {
  const meta = STATUS[status] ?? STATUS.available;
  const Icon = meta.icon;
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback className={cn("bg-line font-semibold text-highlight", fallbackClassName)}>{initials}</AvatarFallback>
      <AvatarBadge className={cn(meta.badge, size === "lg" && "size-4! [&>svg]:size-2.5!")} aria-label={meta.label} role="img">
        {Icon && <Icon strokeWidth={3} />}
      </AvatarBadge>
    </Avatar>
  );
}
