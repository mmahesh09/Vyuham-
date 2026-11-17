"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  ["/support/admin", "Inbox"],
  ["/support/admin/errors", "Errors"],
  ["/support/admin/kb", "Help articles"],
  ["/support/admin/status", "Status & incidents"],
] as const;

/** Tabs across the staff support pages. */
export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Support admin" className="flex flex-wrap gap-1 border-b border-line">
      {TABS.map(([href, label]) => {
        const active = href === "/support/admin" ? path === href || path.startsWith("/support/admin/tickets") : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[14px] transition-colors",
              active ? "border-highlight font-medium text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
