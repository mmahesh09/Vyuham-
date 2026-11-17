"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { Logo } from "@/components/layout/logo";

/** The public site's main menu, shared by the landing page and the content pages. */
export const SITE_NAV = [
  { href: "/", label: "Home" },
  { href: "/signup", label: "Try Vyuham" },
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
  { href: "/help", label: "Support" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Site header. `overlay` sits inside the landing page's hero panel, which is always dark, so it uses
 * light text. The default is the bordered header for content pages (blog, help, status, privacy,
 * about) and follows the light/dark theme through the design tokens.
 */
export function SiteHeader({ overlay = false }: { overlay?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  // Close the phone menu after navigating, and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const t = overlay
    ? {
        header: "relative z-20",
        bar: "px-5 py-5 sm:px-8 sm:py-6",
        pill: "border-white/10 bg-white/[0.06] backdrop-blur-md",
        link: "text-white/75 hover:text-white",
        linkActive: "bg-white/15 text-white",
        login: "text-white/75 hover:text-white",
        cta: "btn-ghost",
        menuButton: "border-white/10 bg-white/[0.06] text-white backdrop-blur-md",
        panel: "border-white/10 bg-[#16100b]/95 backdrop-blur-md",
        item: "text-white/80 hover:bg-white/[0.06] hover:text-white",
        itemActive: "bg-white/10 text-white",
        divider: "border-white/[0.08]",
      }
    : {
        header: "relative z-20 border-b border-line bg-bg",
        bar: "mx-auto max-w-[1080px] px-5 py-4",
        pill: "border-line bg-surface",
        link: "text-muted hover:text-text",
        linkActive: "bg-surface-2 text-text",
        login: "text-muted hover:text-text",
        cta: "border border-line text-text hover:border-line-strong",
        menuButton: "border-line bg-surface text-text",
        panel: "border-line bg-surface",
        item: "text-muted hover:bg-surface-2 hover:text-text",
        itemActive: "bg-surface-2 text-text",
        divider: "border-line",
      };

  return (
    <header className={t.header}>
      <div className={`flex items-center justify-between gap-4 ${t.bar}`}>
        <Logo href="/" />

        <nav aria-label="Main" className={`absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border p-1 md:flex ${t.pill}`}>
          {SITE_NAV.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-9 items-center rounded-full px-4 text-[14px] transition-colors ${active ? t.linkActive : t.link}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <Link href="/login" className={`hidden min-h-11 items-center px-3 text-[14px] sm:flex ${t.login}`}>
            Log in
          </Link>
          <Link href="/signup" className={`hidden min-h-10 items-center rounded-full px-5 text-[14px] font-semibold sm:flex ${t.cta}`}>
            Join beta
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? "Close menu" : "Open menu"}
            className={`flex size-11 items-center justify-center rounded-full border md:hidden ${t.menuButton}`}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      {/* Phone menu */}
      <nav
        id={menuId}
        aria-label="Main"
        hidden={!open}
        className={`absolute inset-x-3 top-full z-30 rounded-[20px] border p-2 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] md:hidden ${t.panel}`}
      >
        <ul className="flex flex-col">
          {SITE_NAV.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-12 items-center rounded-[14px] px-4 text-[16px] ${active ? t.itemActive : t.item}`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
          <li className={`mt-1 border-t pt-1 ${t.divider}`}>
            <Link href="/login" className={`flex min-h-12 items-center rounded-[14px] px-4 text-[16px] ${t.item}`}>
              Log in
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
