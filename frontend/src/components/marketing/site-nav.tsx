"use client";

import { ArrowRight, BarChart3, ChevronDown, Menu, MousePointerClick, Workflow, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useState } from "react";

import { Logo } from "@/components/layout/logo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavLink = { href: string; label: string; match: (path: string) => boolean };
type Product = { href: string; name: string; kind: string; text: string; icon: LucideIcon };

/** The two products in the "Products" menu: Vyuham for analytics, Kaveri for data engineering. */
export const PRODUCTS: Product[] = [
  {
    href: "/#analytics",
    name: "Vyuham",
    kind: "Analytics",
    text: "Ask in plain English, dashboards, metrics, alerts and share links.",
    icon: BarChart3,
  },
  {
    href: "/#pipelines",
    name: "Kaveri",
    kind: "Engineering platform",
    text: "Pipelines, the AI Data Engineer, SQL Workbench, dynamic tables and governance.",
    icon: Workflow,
  },
];
const TRY = { href: "/try", label: "Try Vyuham with sample data" };
const productsActive = (p: string) => p.startsWith("/try");

export const NAV: NavLink[] = [
  { href: "/", label: "Home", match: (p) => p === "/" },
  { href: "/about", label: "About", match: (p) => p.startsWith("/about") },
  { href: "/blog", label: "Blog", match: (p) => p.startsWith("/blog") },
  {
    href: "/support-center",
    label: "Support",
    match: (p) => p.startsWith("/support-center") || p.startsWith("/help") || p.startsWith("/status"),
  },
];

/** Desktop "Products" button and menu: Vyuham, Kaveri, and the sample-data demo. */
function ProductsMenu({ overlay, active }: { overlay: boolean; active: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "group flex min-h-9 items-center gap-1 whitespace-nowrap rounded-full px-4 text-[14px] transition-colors",
              overlay
                ? active
                  ? "bg-white/15 text-white"
                  : "text-white/75 hover:text-white data-[popup-open]:text-white"
                : active
                  ? "bg-surface-2 text-text"
                  : "text-muted hover:text-text data-[popup-open]:text-text",
            )}
          />
        }
      >
        Products
        <ChevronDown className="size-3.5 transition-transform group-data-[popup-open]:rotate-180" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={10} className="w-[min(340px,90vw)] p-1.5">
        {PRODUCTS.map(({ href, name, kind, text, icon: Icon }) => (
          <DropdownMenuItem key={name} render={<Link href={href} />} className="items-start gap-3 rounded-lg p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary/15 text-highlight">
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[14px] font-semibold text-text">
                {name} <span className="font-normal text-faint">· {kind}</span>
              </span>
              <span className="text-[13px] leading-snug text-muted">{text}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={TRY.href} />} className="gap-2 rounded-lg px-3 py-2.5 text-[13px] text-muted">
          <MousePointerClick className="size-4 text-highlight" aria-hidden />
          {TRY.label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The marketing navbar: Home · Products (Vyuham, Kaveri) · About · Blog · Support, plus log in and
 * the beta CTA. `overlay` sits inside the dark hero panel; `bar` is a sticky bar for content pages.
 * Below lg the links move into a slide-in sheet, where the products are listed under their own heading.
 */
export function SiteNav({ variant = "bar" }: { variant?: "overlay" | "bar" }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const overlay = variant === "overlay";
  const link = (l: NavLink) => {
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
  };

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
          {NAV.slice(0, 1).map(link)}
          <ProductsMenu overlay={overlay} active={productsActive(pathname)} />
          {NAV.slice(1).map(link)}
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
            {NAV.map((l, i) => {
              const active = l.match(pathname);
              return (
                <Fragment key={l.href}>
                  <Link
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
                  {i === 0 && (
                    <div className="my-1 flex flex-col gap-1 rounded-xl border border-line p-1.5" role="group" aria-label="Products">
                      <p className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Products</p>
                      {PRODUCTS.map(({ href, name, kind, icon: Icon }) => (
                        <Link
                          key={name}
                          href={href}
                          onClick={() => setOpen(false)}
                          className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-[15px] text-muted transition-colors hover:bg-surface hover:text-text"
                        >
                          <Icon className="size-4 shrink-0 text-highlight" aria-hidden />
                          <span>
                            <span className="font-medium text-text">{name}</span> <span className="text-[13px] text-faint">· {kind}</span>
                          </span>
                        </Link>
                      ))}
                      <Link
                        href={TRY.href}
                        onClick={() => setOpen(false)}
                        aria-current={productsActive(pathname) ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[14px] transition-colors",
                          productsActive(pathname) ? "bg-surface-2 text-text" : "text-muted hover:bg-surface hover:text-text",
                        )}
                      >
                        <MousePointerClick className="size-4 shrink-0 text-highlight" aria-hidden />
                        {TRY.label}
                      </Link>
                    </div>
                  )}
                </Fragment>
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
