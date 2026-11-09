"use client";

import { format, formatDistanceToNow } from "date-fns";
import { useEffect, useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { useActivity } from "./api";

/** "Last change 2 hours ago" with the latest team changes on hover/click (ReUI c-popover-9). */
export function TeamStatusPopover({ className }: { className?: string }) {
  const { data } = useActivity();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const latest = data?.[0];
  if (!latest) return null;
  const at = new Date(latest.at);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop()?.replace("_", " ") || "Local";

  return (
    <p className={className ?? "text-[13px] text-faint"}>
      Last change{" "}
      <Popover>
        <PopoverTrigger
          openOnHover
          render={<button type="button" className="text-text underline decoration-dashed decoration-1 underline-offset-4" />}
        >
          {formatDistanceToNow(at, { addSuffix: true })}
        </PopoverTrigger>
        <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0" align="start">
          <p className="border-b border-line px-3 py-2 text-sm font-medium">Recent team changes</p>
          <ul className="flex max-h-64 flex-col overflow-y-auto">
            {data.slice(0, 6).map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 border-b border-line/60 px-3 py-2 last:border-b-0">
                <span className="text-sm">
                  <span className="font-medium">{a.actor}</span> <span className="text-muted">{a.title.toLowerCase()}</span>
                </span>
                <span className="text-xs text-faint">{formatDistanceToNow(new Date(a.at), { addSuffix: true })}</span>
              </li>
            ))}
          </ul>
          <table className="w-full border-t border-line text-xs">
            <tbody>
              <tr>
                <td className="py-1.5 pl-3 pr-3">
                  <Badge variant="outline">UTC</Badge>
                </td>
                <td className="pr-3">{format(new Date(at.getTime() + at.getTimezoneOffset() * 60_000), "MMM d, yyyy")}</td>
                <td className="pr-3 text-muted">{format(new Date(at.getTime() + at.getTimezoneOffset() * 60_000), "hh:mm a")}</td>
              </tr>
              <tr>
                <td className="pb-2 pl-3 pr-3">
                  <span className="rounded bg-line px-1.5 py-0.5 font-medium">{zone}</span>
                </td>
                <td className="pb-2 pr-3">{format(at, "MMM d, yyyy")}</td>
                <td className="pb-2 pr-3 text-muted">
                  {format(at, "hh:mm a")}
                  <span className="sr-only"> (now {format(now, "hh:mm a")})</span>
                </td>
              </tr>
            </tbody>
          </table>
        </PopoverContent>
      </Popover>
    </p>
  );
}
