import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { cn } from "@/lib/utils";

/**
 * The announcement pill: short news at the top of a page or card, with a shine that sweeps across it.
 * Pass `href` to make it a link (an arrow is added). Text should stay short, one line on a phone.
 */
export function Announcement({
  children,
  href,
  size = "md",
  className,
}: {
  children: React.ReactNode;
  href?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const pill = cn(
    "group inline-flex w-fit max-w-full items-center rounded-full border border-primary/30 bg-primary/[0.08] transition-colors",
    size === "sm" ? "min-h-7 px-3" : "min-h-9 px-4",
    href && "hover:border-primary/55 hover:bg-primary/[0.14]",
    className,
  );
  const text = (
    <AnimatedShinyText
      shimmerWidth={size === "sm" ? 60 : 100}
      className={cn(
        "mx-0 inline-flex max-w-none items-center gap-1.5 font-mono uppercase tracking-[0.14em]",
        "text-highlight/75 dark:text-highlight/75 via-highlight via-50% dark:via-white/90",
        "motion-reduce:animate-none",
        size === "sm" ? "text-[10.5px]" : "text-[11.5px] sm:text-[12px]",
      )}
    >
      {children}
      {href && <ArrowRight className="size-3 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />}
    </AnimatedShinyText>
  );

  return href ? (
    <Link href={href} className={pill}>
      {text}
    </Link>
  ) : (
    <span className={pill}>{text}</span>
  );
}
