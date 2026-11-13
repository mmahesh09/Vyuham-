import { cn } from "@/lib/utils";

const WIDTHS = {
  narrow: "max-w-[960px]",
  default: "max-w-[1120px]",
  wide: "max-w-[1400px]",
} as const;

/** The one place page widths live: narrow for reading, default for most pages, wide for workbenches. */
export function PageContainer({
  width = "default",
  className,
  ...props
}: React.ComponentProps<"div"> & { width?: keyof typeof WIDTHS }) {
  return <div className={cn("mx-auto flex w-full flex-col gap-8", WIDTHS[width], className)} {...props} />;
}
