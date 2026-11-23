"use client";

import { ArrowRight, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/layout/logo";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavLink = { href: string; label: string; match: (path: string) => boolean };

export const NAV: NavLink[] = [
  { href: "/", label: "Home", match: (p) => p === "/" },
  // An anchor on the homepage, so it's never the "current" page.
  { href: "/#platform", label: "Platform", match: () => false },
  { href: "/try", label: "Try Vyuham", match: (p) => p.startsWith("/try") },
  { href: "/about", label: "About", match: (p) => p.startsWith("/about") },
  { href: "/blog", label: "Blog", match: (p) => p.startsWith("/blog") },
  {
    href: "/support-center",
    label: "Support",
    match: (p) => p.startsWith("/support-center") || p.startsWith("/help") || p.startsWith("/status"),
  },
];

/**
 * The marketing navbar: Home · Platform · Try Vyuham · About · Blog · Support, plus log in and the beta CTA.
 * `overlay` sits inside the dark hero panel; `bar` is a sticky bar for content pages.
 * Below lg the links move into a slide-in sheet.
 */
export function SiteNav({ variant = "bar" }: { variant?: "overlay" | "bar" }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const overlay = variant === "overlay";

  return (
    <header
      className={cn(
        "z-30",
        overlay ? "relative" : "sticky top-0 border-b border-line bg-bg/80 backdrop-blur-md",
      )}
    >
      <div
        className={cn(
          "relative flex items-center justify-between gap-4",
          overlay ? "px-4 py-4 sm:px-8 sm:py-6" : "mx-auto max-w-[1200px] px-[clamp(16px,5vw,48px)] py-3.5",
        )}
      >
        <Logo href="/" />

        <nav
          aria-label="Main"
          className={cn(
            "absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border p-1 backdrop-blur-md lg:flex",
            overlay ? "border-white/10 bg-white/[0.06]" : "border-line bg-surface/70",
          )}
        >
          {NAV.map((l) => {
            const active = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-9 items-center whitespace-nowrap rounded-full px-4 text-[14px] transition-colors",
                  overlay
                    ? active
                      ? "bg-white/15 text-white"
                      : "text-white/75 hover:text-white"
                    : active
                      ? "bg-surface-2 text-text"
                      : "text-muted hover:text-text",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <Link
            href="/login"
            className={cn(
              "hidden min-h-11 items-center px-3 text-[14px] sm:flex",
              overlay ? "text-white/75 hover:text-white" : "text-muted hover:text-text",
            )}
          >
            Log in
          </Link>
          <Link href="/signup" className="btn-ghost hidden min-h-10 items-center rounded-full px-5 text-[14px] font-semibold sm:flex">
            Start free
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className={cn(
              "flex size-11 items-center justify-center rounded-full transition-colors lg:hidden",
              overlay ? "text-white/85 hover:bg-white/10" : "text-muted hover:bg-surface hover:text-text",
            )}
          >
            <Menu className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[min(320px,88vw)] gap-6 border-line bg-bg px-4 py-5">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="pr-10">
            <Logo href="/" />
          </div>
          <nav aria-label="Main" className="flex flex-col gap-1">
            {NAV.map((l) => {
              const active = l.match(pathname);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center rounded-xl px-4 text-[16px] transition-colors",
                    active ? "bg-surface-2 font-medium text-text" : "text-muted hover:bg-surface hover:text-text",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto flex flex-col gap-2 border-t border-line pt-5">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="flex min-h-12 items-center justify-center rounded-full border border-line-strong text-[15px] text-text"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              onClick={() => setOpen(false)}
              className="btn-primary flex min-h-12 items-center justify-center gap-2 rounded-full text-[15px] font-semibold"
            >
              Start free <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
