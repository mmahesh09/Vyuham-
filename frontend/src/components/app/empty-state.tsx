import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

/** An empty screen is an invitation to act: an icon, one title, one sentence, one action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Smaller padding, for empty states inside cards. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <Empty className={cn("border border-dashed border-line-strong", compact ? "py-8" : "py-14", className)}>
      <EmptyHeader>
        {icon && (
          <EmptyMedia variant="icon" className="size-10 rounded-lg bg-line text-highlight [&_svg:not([class*='size-'])]:size-5">
            {icon}
          </EmptyMedia>
        )}
        <EmptyTitle className="text-[15px] font-semibold text-text">{title}</EmptyTitle>
        {description && <EmptyDescription className="text-muted">{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
