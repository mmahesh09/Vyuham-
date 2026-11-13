import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The app's one surface. `surface` is a bordered panel; `list` holds divided rows (put `PanelRow`s
 * inside); `interactive` is a whole-card link whose border brightens on hover (no lift, no shadow).
 */
export const panelVariants = cva("rounded-xl border border-line bg-surface", {
  variants: {
    variant: {
      surface: "p-5 sm:p-6",
      list: "flex flex-col divide-y divide-line overflow-hidden",
      interactive: "block p-5 transition-colors duration-200 hover:border-line-strong hover:bg-surface-2/60 focus-visible:border-highlight focus-visible:outline-none",
    },
  },
  defaultVariants: { variant: "surface" },
});

export function Panel({ variant, className, ...props }: React.ComponentProps<"div"> & VariantProps<typeof panelVariants>) {
  return <div className={cn(panelVariants({ variant }), className)} {...props} />;
}

/** A row inside a `list` panel. Pass `interactive` when the row is (or wraps) a link. */
export function PanelRow({ interactive, className, ...props }: React.ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", interactive && "transition-colors duration-150 hover:bg-surface-2/70", className)}
      {...props}
    />
  );
}
