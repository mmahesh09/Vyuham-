"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { usePageCrumb } from "@/components/app/page-crumb";
import { cn } from "@/lib/utils";

type Props = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Detail pages: a link back to the list. */
  back?: { href: string; label: string };
  /** Buttons on the right of the title. */
  actions?: React.ReactNode;
  /** The page's name in the top bar breadcrumb, for pages whose title isn't plain text or is data (a dashboard's name). */
  crumb?: string;
  className?: string;
  /** Tabs or a toolbar that belong to the header. */
  children?: React.ReactNode;
};

/** Every app page starts with this: one title size, one description style, actions on the right. */
export function PageHeader({ title, description, back, actions, crumb, className, children }: Props) {
  const setCrumb = usePageCrumb((s) => s.setCrumb);
  useEffect(() => {
    if (!crumb) return;
    setCrumb(crumb);
    return () => setCrumb(null);
  }, [crumb, setCrumb]);

  return (
    <header className={cn("flex flex-col gap-4", className)}>
      {back && (
        <Link href={back.href} className="flex w-fit items-center gap-1.5 rounded-md text-[13px] text-faint transition-colors hover:text-text">
          <ArrowLeft className="size-3.5" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          {typeof title === "string" ? <h1 className="type-page-title text-text">{title}</h1> : title}
          {description && <div className="max-w-[68ch] text-[15px] leading-relaxed text-muted">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
