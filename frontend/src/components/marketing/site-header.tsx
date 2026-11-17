"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { Logo } from "@/components/layout/logo";

/** The public site's main menu. Shared by every marketing page so it stays the same everywhere. */
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
 * Top navigation for the public site. `overlay` sits inside the landing page's hero panel;
 * the default variant is a bordered bar for the other pages.
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

  return (
    <header className={overlay ? "relative z-20" : "relative z-20 border-b border-white/[0.06]"}>
      <div className={`flex items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6 ${overlay ? "" : "mx-auto max-w-[1200px]"}`}>
        <Logo />

        <nav
          aria-label="Main"
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] p-1 backdrop-blur-md md:flex"
        >
          {SITE_NAV.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-9 items-center rounded-full px-4 text-[14px] transition-colors ${
                  active ? "bg-white/15 text-white" : "text-white/75 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <Link href="/login" className="hidden min-h-11 items-center px-3 text-[14px] text-white/75 hover:text-white sm:flex">
            Log in
          </Link>
          <Link href="/signup" className="btn-ghost hidden min-h-10 items-center rounded-full px-5 text-[14px] font-semibold sm:flex">
            Join beta
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex size-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white backdrop-blur-md md:hidden"
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
        className="absolute inset-x-3 top-full z-30 rounded-[20px] border border-white/10 bg-[#0b0918]/95 p-2 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-md md:hidden"
      >
        <ul className="flex flex-col">
          {SITE_NAV.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-12 items-center rounded-[14px] px-4 text-[16px] ${active ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/[0.06] hover:text-white"}`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
          <li className="mt-1 border-t border-white/[0.08] pt-1">
            <Link href="/login" className="flex min-h-12 items-center rounded-[14px] px-4 text-[16px] text-white/80 hover:bg-white/[0.06] hover:text-white">
              Log in
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
