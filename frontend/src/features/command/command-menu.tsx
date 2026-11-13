"use client";

import { Command } from "cmdk";
import { BellRing, Code2, Database, FileSpreadsheet, FileText, House, LayoutDashboard, LayoutGrid, LayoutTemplate, Sparkle, UserRound, Users, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useDashboards } from "@/features/dashboards/hooks";
import { useDatasets } from "@/features/datasets/api";
import { useUiStore } from "@/stores/ui-store";

const PAGES: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Home", href: "/home", icon: House },
  { label: "Data", href: "/data", icon: Database },
  { label: "Dashboards", href: "/dashboards", icon: LayoutDashboard },
  { label: "Templates", href: "/templates", icon: LayoutTemplate },
  { label: "SQL Lab", href: "/sql", icon: Code2 },
  { label: "Dashboard Lab", href: "/lab", icon: LayoutGrid },
  { label: "Alerts & automations", href: "/alerts", icon: BellRing },
  { label: "Reports", href: "/reports", icon: FileText },
  { label: "Team", href: "/team", icon: Users },
  { label: "Profile", href: "/profile", icon: UserRound },
];

const item =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-3 text-[15px] text-text data-[selected=true]:bg-white/10 data-[selected=true]:text-text data-[disabled=true]:cursor-default data-[disabled=true]:opacity-60";
const group = "px-2 pb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint";

/** Ctrl/⌘ + K: jump anywhere, open a dashboard, or start a question. */
export function CommandMenu() {
  const router = useRouter();
  const { commandOpen, commandQuery, setCommandOpen, openCommand } = useUiStore();
  const [search, setSearch] = useState("");
  const { data: dashboards } = useDashboards();
  const { data: datasets } = useDatasets();

  // Each time the menu opens, start from the question passed in (or empty).
  useEffect(() => {
    if (commandOpen) setSearch(commandQuery);
  }, [commandOpen, commandQuery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (useUiStore.getState().commandOpen) setCommandOpen(false);
        else openCommand();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCommand, setCommandOpen]);

  const go = (href: string) => {
    setCommandOpen(false);
    router.push(href);
  };

  return (
    <Command.Dialog
      open={commandOpen}
      onOpenChange={setCommandOpen}
      label="Command menu"
      overlayClassName="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[14vh] z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[16px] border border-line bg-[#110e22] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
    >
      <Command.Input
        value={search}
        onValueChange={setSearch}
        placeholder="Search pages and dashboards, or type a question…"
        className="h-14 w-full border-b border-line bg-transparent px-5 text-base text-text placeholder:text-faint focus:outline-none"
      />
      <Command.List data-lenis-prevent className="max-h-[min(420px,60vh)] overflow-y-auto overscroll-contain py-2">
        <Command.Empty className="px-5 py-6 text-sm text-muted">Nothing found.</Command.Empty>

        <Command.Group heading="Go to" className={group}>
          {PAGES.map(({ label, href, icon: Icon }) => (
            <Command.Item key={href} value={`go ${label}`} onSelect={() => go(href)} className={item}>
              <Icon className="size-4 text-highlight" strokeWidth={1.8} aria-hidden />
              {label}
            </Command.Item>
          ))}
        </Command.Group>

        {!!dashboards?.length && (
          <Command.Group heading="Dashboards" className={group}>
            {dashboards.map((d) => (
              <Command.Item key={d.id} value={`dashboard ${d.name} ${d.id}`} onSelect={() => go(`/dashboards/${d.id}`)} className={item}>
                <LayoutDashboard className="size-4 text-highlight" strokeWidth={1.8} aria-hidden />
                {d.name}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {!!datasets?.length && (
          <Command.Group heading="Data" className={group}>
            {datasets.map((d) => (
              <Command.Item key={d.id} value={`dataset ${d.name} ${d.id}`} onSelect={() => go(`/data/${d.id}`)} className={item}>
                <FileSpreadsheet className="size-4 text-highlight" strokeWidth={1.8} aria-hidden />
                {d.name}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Ask" className={group} forceMount>
          <Command.Item
            value="ask question"
            className={item}
            forceMount
            onSelect={() => go(search.trim() ? `/home?q=${encodeURIComponent(search.trim())}` : "/home")}
          >
            <Sparkle className="size-4 text-accent" strokeWidth={1.8} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{search.trim() ? `Ask: “${search.trim()}”` : "Ask your data in plain English"}</span>
          </Command.Item>
        </Command.Group>
      </Command.List>
      <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-xs text-faint">
        <span>↑↓ to move · Enter to open</span>
        <span>Esc to close</span>
      </div>
    </Command.Dialog>
  );
}
