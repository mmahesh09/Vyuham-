"use client";

import { format, parseISO } from "date-fns";
import { Plane } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { usePresence, useSetPresence, type PresenceStatus } from "./api";
import { LEAVE_LABEL, MENU_STATUSES, PresenceAvatar, STATUS, StatusDot } from "./status";

/** Click your avatar to change status, like Teams. "On leave" needs details, so it opens the profile form. */
export function StatusMenu({ initials, size = "default" }: { initials: string; size?: "sm" | "default" | "lg" }) {
  const router = useRouter();
  const { data } = usePresence();
  const set = useSetPresence();
  const status = data?.status ?? "available";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" className="shrink-0 rounded-full" aria-label={`Your status: ${STATUS[status].label}. Change status`} />}
      >
        <PresenceAvatar initials={initials} status={status} size={size} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {status === "on_leave" && data?.leave
              ? `${LEAVE_LABEL[data.leave.leave_type]} until ${format(parseISO(data.leave.end_date), "MMM d")} · ${data.leave.backup_name} covering`
              : "Set your status"}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={status === "on_leave" ? "" : status}
            onValueChange={(value) => set.mutate({ status: value as PresenceStatus, message: data?.message })}
          >
            {MENU_STATUSES.map((s) => (
              <DropdownMenuRadioItem key={s} value={s} disabled={set.isPending}>
                <StatusDot status={s} />
                <span className="flex flex-col">
                  <span>{STATUS[s].label}</span>
                  <span className="text-[11px] text-muted-foreground">{STATUS[s].hint}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/profile#status")}>
          <Plane className="size-4" aria-hidden />
          {status === "on_leave" ? "Change leave or backup…" : "I'm on leave…"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
