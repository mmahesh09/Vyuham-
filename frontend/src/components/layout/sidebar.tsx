"use client";

import { BellRing, Code2, Command, Compass, Database, House, LayoutDashboard, LayoutGrid, LayoutTemplate, LogOut, Presentation, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/layout/logo";
import { NotificationBell } from "@/features/alerts/notification-bell";
import { useLogout } from "@/features/auth/hooks";
import { StatusMenu } from "@/features/presence/status-menu";
import { TeamStatusPopover } from "@/features/profile/team-status-popover";
import { initials } from "@/features/profile/team-tree";
import { useTour } from "@/features/tour/guided-tour";
import { useUiStore } from "@/stores/ui-store";

const NAV = [
  { href: "/home", label: "Home", icon: House },
  { href: "/dashboards", label: "Dashboards", icon: LayoutDashboard },
  { href: "/data", label: "Data", icon: Database },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/sql", label: "SQL Lab", icon: Code2 },
  { href: "/lab", label: "Dashboard Lab", icon: LayoutGrid },
  { href: "/alerts", label: "Alerts", icon: BellRing },
  // The open-slide deck app (my-deck/): a separate static app, so a full page load, not <Link>.
  { href: "/decks", label: "Decks", icon: Presentation, external: true },
  { href: "/team", label: "Team", icon: Users },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export function Sidebar({ workspaceName, userName }: { workspaceName: string; userName: string }) {
  const pathname = usePathname();
  const logout = useLogout();
  const openCommand = useUiStore((s) => s.openCommand);
  const startTour = useTour((s) => s.start);

  return (
    <nav
      aria-label="Main"
      className="flex flex-[1_1_220px] flex-col gap-8 border-line px-[18px] py-7 max-md:border-b md:border-r"
    >
      <Logo href="/home" />
      <ul className="flex flex-col gap-1 max-md:flex-row max-md:flex-wrap">
        {NAV.map(({ href, label, icon: Icon, external }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const className = `flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] ${
            active ? "bg-line font-semibold text-text" : "font-medium text-muted hover:text-text"
          }`;
          const content = (
            <>
              <Icon className={`size-[18px] ${active ? "text-highlight" : ""}`} strokeWidth={1.8} aria-hidden />
              {label}
            </>
          );
          return (
            <li key={href}>
              {external ? (
                <a href={href} data-tour={`nav-${href}`} className={className}>
                  {content}
                </a>
              ) : (
                <Link href={href} data-tour={`nav-${href}`} aria-current={active ? "page" : undefined} className={className}>
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-auto flex flex-col gap-2">
      <button
        type="button"
        onClick={startTour}
        className="flex min-h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] text-faint hover:text-text"
      >
        <Compass className="size-4" strokeWidth={1.8} aria-hidden />
        Take the tour
      </button>
      <div className="flex gap-2">
      <button
        type="button"
        data-tour="search"
        onClick={() => openCommand()}
        className="flex min-h-11 flex-1 items-center gap-3 rounded-[10px] border border-line px-3 text-[14px] text-muted hover:text-text"
      >
        <Command className="size-4" strokeWidth={1.8} aria-hidden />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded-[4px] bg-line px-1.5 py-0.5 font-sans text-[11px] text-highlight">Ctrl K</kbd>
      </button>
      <NotificationBell />
      </div>
      </div>
      <div data-tour="workspace" className="flex items-center justify-between gap-2 rounded-xl border border-line p-3.5">
        <StatusMenu initials={initials(userName)} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{workspaceName}</span>
          <Link href="/profile" className="truncate text-[13px] text-faint hover:text-text">
            {userName} · Free beta
          </Link>
          <TeamStatusPopover className="truncate text-[12px] text-faint" />
        </div>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-label="Log out"
          className="flex size-11 shrink-0 items-center justify-center rounded-[10px] text-faint hover:bg-surface hover:text-text"
        >
          <LogOut className="size-[18px]" strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
