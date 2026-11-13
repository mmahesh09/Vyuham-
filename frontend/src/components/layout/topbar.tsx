"use client";

import { Menu, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

import { usePageCrumb } from "@/components/app/page-crumb";
import { Logo } from "@/components/layout/logo";
import { NAV_GROUPS, SidebarNav } from "@/components/layout/sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { NotificationBell } from "@/features/alerts/notification-bell";
import { useUiStore } from "@/stores/ui-store";

const SECTIONS: Record<string, string> = {
  ...Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.href, i.label]))),
  "/profile": "Profile",
};

/** Section › page, from the URL plus the name the page reports (a dashboard's title). */
function useCrumbs() {
  const pathname = usePathname();
  const crumb = usePageCrumb((s) => s.crumb);
  const first = `/${pathname.split("/")[1] ?? ""}`;
  const section = SECTIONS[first];
  if (!section) return [];
  const deeper = pathname.split("/").filter(Boolean).length > 1;
  if (!deeper) return [{ label: section }];
  return [{ label: section, href: first }, { label: crumb ?? (pathname.endsWith("/new") ? "New" : "…") }];
}

/** Sticky top bar: where you are, search or ask (Ctrl/⌘ K), notifications, and the menu on small screens. */
export function Topbar({ workspaceName, userName }: { workspaceName: string; userName: string }) {
  const openCommand = useUiStore((s) => s.openCommand);
  const crumbs = useCrumbs();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/85 px-[clamp(16px,3vw,32px)] backdrop-blur-md">
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label="Open menu"
        className="-ml-2 flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-text lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap text-[13.5px] text-faint">
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <BreadcrumbSeparator className="text-line-strong" />}
              <BreadcrumbItem className={i === crumbs.length - 1 ? "min-w-0" : "shrink-0 max-sm:hidden"}>
                {c.href ? (
                  <Link href={c.href} className="transition-colors hover:text-text">
                    {c.label}
                  </Link>
                ) : (
                  <BreadcrumbPage className="truncate font-medium text-text">{c.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <button
        type="button"
        data-tour="search"
        onClick={() => openCommand()}
        aria-label="Search or ask a question"
        className="flex h-9 items-center gap-2.5 rounded-lg border border-line bg-surface px-3 text-[13.5px] text-faint transition-colors hover:border-line-strong hover:text-text max-sm:w-9 max-sm:justify-center max-sm:px-0 sm:min-w-[220px]"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left max-sm:hidden">Search or ask…</span>
        <kbd className="rounded-[5px] border border-line px-1.5 py-0.5 font-sans text-[11px] text-muted max-sm:hidden">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <NotificationBell />

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-[min(300px,86vw)] gap-5 border-line bg-bg px-3 py-5">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="pr-10">
            <Logo href="/home" />
          </div>
          <SidebarNav workspaceName={workspaceName} userName={userName} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
