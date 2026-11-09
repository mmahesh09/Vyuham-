/**
 * Marker-swipe highlight for a key phrase in body copy. Inside a `[data-animate]` block it
 * sweeps in when the block scrolls into view (see `mark.mark` in globals.css); `sweepOnLoad` sweeps
 * it in on page load instead (for above-the-fold copy). Without JS or with reduced motion it is
 * simply shown. Use one or two per paragraph, never on headings.
 */
export function Mark({
  children,
  tone = "pink",
  sweepOnLoad = false,
}: {
  children: React.ReactNode;
  tone?: "pink" | "violet";
  sweepOnLoad?: boolean;
}) {
  return (
    <mark className={sweepOnLoad ? "mark mark--load" : "mark"} data-tone={tone}>
      {children}
    </mark>
  );
}
