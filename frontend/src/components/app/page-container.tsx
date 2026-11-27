import { cn } from "@/lib/utils";

/**
 * Page width caps, measured against the space left of the sidebar (never the whole viewport).
 * - narrow: reading and single forms; long lines hurt here.
 * - medium: settings and threads with a side column.
 * - default: lists and overviews; fills a 1920px monitor, centres with modest gutters beyond that.
 * - wide: workbenches (tables, canvases, editors) take every pixel.
 */
export const PAGE_WIDTHS = {
  narrow: "max-w-[960px]",
  medium: "max-w-[1240px]",
  default: "max-w-[1680px]",
  wide: "max-w-none",
} as const;

/** The one place page widths live. */
export function PageContainer({
  width = "default",
  className,
  ...props
}: React.ComponentProps<"div"> & { width?: keyof typeof PAGE_WIDTHS }) {
  return <div className={cn("mx-auto flex w-full min-w-0 flex-col gap-8", PAGE_WIDTHS[width], className)} {...props} />;
}
