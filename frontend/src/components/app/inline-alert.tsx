import { CircleAlert, Info } from "lucide-react";

import { cn } from "@/lib/utils";

/** One box for errors and notices: says what happened and what to do, next to where it happened. */
export function InlineAlert({
  tone = "error",
  children,
  action,
  className,
}: {
  tone?: "error" | "info";
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? CircleAlert : Info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        tone === "error" ? "border-accent/40 bg-accent/10 text-text" : "border-line-strong bg-surface-2/60 text-muted",
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "error" ? "text-accent" : "text-highlight")} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
