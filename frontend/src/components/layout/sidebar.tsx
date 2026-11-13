"use client";

import {
  BellRing,
  Code2,
  Compass,
  Database,
  FileText,
  House,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Presentation,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo, LogoMark } from "@/components/layout/logo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLogout } from "@/features/auth/hooks";
import { StatusMenu } from "@/features/presence/status-menu";
import { TeamStatusPopover } from "@/features/profile/team-status-popover";
import { initials } from "@/features/profile/team-tree";
import { useTour } from "@/features/tour/guided-tour";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; external?: boolean };

/** Grouped by what people are doing: look at answers, build them, send them out, work together. */
export const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/home", label: "Home", icon: House },
      { href: "/dashboards", label: "Dashboards", icon: LayoutDashboard },
      { href: "/data", label: "Data", icon: Database },
      { href: "/templates", label: "Templates", icon: LayoutTemplate },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/sql", label: "SQL Lab", icon: Code2 },
      { href: "/lab", label: "Dashboard Lab", icon: LayoutGrid },
    ],
  },
  {
    label: "Share",
    items: [
      { href: "/alerts", label: "Alerts", icon: BellRing },
      { href: "/reports", label: "Reports", icon: FileText },
      // The open-slide deck app (my-deck/): a separate static app, so a full page load, not <Link>.
      { href: "/decks", label: "Decks", icon: Presentation, external: true },
    ],
  },
  { label: "Team", items: [{ href: "/team", label: "Team", icon: Users }] },
];

const COLLAPSE_KEY = "vyuham:sidebar-collapsed";

/** Links and workspace card. Used by the desktop sidebar and the mobile drawer. */
export function SidebarNav({
  workspaceName,
  userName,
  collapsed = false,
  onNavigate,
}: {
  workspaceName: string;
  userName: string;
  collapsed?: boolean;
  /** Called after a link is followed (the mobile drawer closes itself). */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const logout = useLogout();
  const startTour = useTour((s) => s.start);

  return (
    <>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto py-1">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className="flex flex-col gap-0.5">
            {group.label && group.items.length > 1 && !collapsed && (
              <p className="px-3 pb-1 text-[12px] font-medium text-faint">{group.label}</p>
            )}
            {group.label && collapsed && gi > 0 && <div className="mx-3 mb-1 border-t border-line" aria-hidden />}
            <ul className="flex flex-col gap-0.5">
              {group.items.map(({ href, label, icon: Icon, external }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                const className = cn(
                  "group flex min-h-10 items-center gap-3 rounded-lg px-3 text-[14px] transition-colors duration-150",
                  collapsed && "justify-center px-0",
                  active ? "bg-line font-semibold text-text" : "font-medium text-muted hover:bg-surface hover:text-text",
                );
                const content = (
                  <>
                    <Icon className={cn("size-[18px] shrink-0", active ? "text-highlight" : "text-faint group-hover:text-muted")} strokeWidth={1.8} aria-hidden />
                    {collapsed ? <span className="sr-only">{label}</span> : label}
                  </>
                );
                return (
                  <li key={href}>
                    {external ? (
                      <a href={href} data-tour={`nav-${href}`} className={className} title={collapsed ? label : undefined}>
                        {content}
                      </a>
                    ) : (
                      <Link
                        href={href}
                        data-tour={`nav-${href}`}
                        aria-current={active ? "page" : undefined}
                        className={className}
                        title={collapsed ? label : undefined}
                        onClick={onNavigate}
                      >
                        {content}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div
        data-tour="workspace"
        className={cn("flex items-center gap-2.5 rounded-xl border border-line bg-surface/60", collapsed ? "flex-col p-2" : "p-2.5")}
      >
        <StatusMenu initials={initials(userName)} />
        {!collapsed && (
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13.5px] font-semibold text-text">{workspaceName}</span>
            <TeamStatusPopover className="truncate text-left text-[12px] text-faint hover:text-text" />
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Account and workspace menu"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-surface-2 hover:text-text"
              />
            }
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent side={collapsed ? "right" : "top"} align="end" className="w-56">
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium text-text">{userName}</p>
              <p className="truncate text-xs text-faint">{workspaceName} · Free beta</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/profile" onClick={onNavigate} />}>
              <UserRound aria-hidden /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => (onNavigate?.(), startTour())}>
              <Compass aria-hidden /> Take the tour
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logout.mutate()} disabled={logout.isPending}>
              <LogOut aria-hidden /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

/** Desktop sidebar (lg and up): sticky, grouped, collapsible to an icon rail that's remembered per browser. */
export function Sidebar({ workspaceName, userName }: { workspaceName: string; userName: string }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage blocked: start expanded */
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* not remembered */
      }
      return !c;
    });
  };

  return (
    <nav
      aria-label="Main"
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col gap-6 border-r border-line bg-bg px-3 py-5 transition-[width] duration-200 ease-[var(--ease-out-quart)] lg:flex",
        collapsed ? "w-[68px]" : "w-[240px]",
      )}
    >
      <div className={cn("flex items-center", collapsed ? "flex-col gap-3" : "justify-between pr-1")}>
        {collapsed ? (
          <Link href="/home" aria-label="Vyuham home" className="rounded-lg">
            <LogoMark />
          </Link>
        ) : (
          <Logo href="/home" />
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="flex size-8 items-center justify-center rounded-lg text-faint transition-colors hover:bg-surface hover:text-text"
        >
          {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
        </button>
      </div>
      <SidebarNav workspaceName={workspaceName} userName={userName} collapsed={collapsed} />
    </nav>
  );
}
