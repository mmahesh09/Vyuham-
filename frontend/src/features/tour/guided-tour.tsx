"use client";

import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import { useMe } from "@/features/auth/hooks";

type Step = {
  /** CSS selector of the element to spotlight; none = a centred card. */
  target?: string;
  /** Page the target lives on; the tour navigates there first. */
  route?: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  { title: "Welcome to Vyuham", body: "A two-minute tour of where everything lives. You can leave any time with Esc and replay it from the sidebar." },
  { target: '[data-tour="ask"]', route: "/home", title: "Ask in plain English", body: "Type a question like “revenue by month” or “top 5 clients this year”. You get the answer as a sentence and a chart you can save." },
  { target: '[data-tour="nav-/data"]', title: "Your data", body: "Upload Excel or CSV files. Open one to search every row, fix column types or replace the file with a newer one." },
  { target: '[data-tour="nav-/dashboards"]', title: "Dashboards", body: "A feed of insights with filters. Add charts from a gallery of templates: trends, rankings, funnels, treemaps, gauges and more." },
  { target: '[data-tour="nav-/templates"]', title: "Templates", body: "Ready-made Sales, Startup metrics and Expenses dashboards. Map your columns once and get the full set." },
  { target: '[data-tour="nav-/sql"]', title: "SQL Lab", body: "For the SQL-minded: query your datasets directly, save queries, and turn results into charts." },
  { target: '[data-tour="nav-/lab"]', title: "Dashboard Lab", body: "Lay any dashboard out on a free-form canvas: drag charts anywhere and size them however you like." },
  { target: '[data-tour="nav-/alerts"]', title: "Alerts & automations", body: "Get told when a number crosses a line, and send dashboard digests on a schedule by in-app message, email or Slack/Teams." },
  { target: '[data-tour="nav-/team"]', title: "Team", body: "Invite people, assign data tasks on a board, timeline or calendar, and see who's on leave and who's covering." },
  { target: '[data-tour="bell"]', title: "Notifications", body: "Alerts and digests land here. The dot shows anything you haven't read." },
  { target: '[data-tour="search"]', title: "Jump anywhere", body: "Press Ctrl+K (⌘K on Mac) to open any page, dashboard or dataset, or to ask a question." },
  { target: '[data-tour="workspace"]', title: "Your status", body: "Click your avatar to set Available, Busy, Away or On leave. Your profile has your role, working hours and signature." },
  { title: "You're all set", body: "Start by adding a spreadsheet on the Data page. Replay this tour any time from “Take the tour” in the sidebar." },
];

const storageKey = (userId: string) => `vyuham:tour:v1:${userId}`;

/** Lets any button (e.g. "Take the tour" in the sidebar) start the tour. */
export const useTour = create<{ open: boolean; step: number; start: () => void; close: () => void; go: (n: number) => void }>()((set) => ({
  open: false,
  step: 0,
  start: () => set({ open: true, step: 0 }),
  close: () => set({ open: false }),
  go: (step) => set({ step }),
}));

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8;
const CARD_W = 340;

function useTargetRect(selector: string | undefined, active: boolean) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  useLayoutEffect(() => {
    if (!active || !selector) {
      setRect(null);
      setMissing(false);
      return;
    }
    let tries = 0;
    let frame = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) {
        // The page may still be rendering after a navigation: keep looking for ~4s.
        if (tries++ < 80) frame = window.setTimeout(measure, 50);
        else setMissing(true);
        return;
      }
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      const update = () => {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
      };
      update();
      window.setTimeout(update, 350); // after smooth scrolling settles
      window.addEventListener("resize", update);
      window.addEventListener("scroll", update, true);
      cleanup = () => {
        window.removeEventListener("resize", update);
        window.removeEventListener("scroll", update, true);
      };
    };
    let cleanup = () => {};
    setMissing(false);
    measure();
    return () => {
      window.clearTimeout(frame);
      cleanup();
    };
  }, [selector, active]);
  return { rect, missing };
}

function cardPosition(rect: Rect | null): React.CSSProperties {
  if (!rect || typeof window === "undefined") return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_W, vw - 32);
  // Prefer the right of the target (sidebar items), then below, then above.
  if (rect.left + rect.width + 16 + width < vw) {
    return { top: Math.min(Math.max(16, rect.top), vh - 260), left: rect.left + rect.width + 16, width };
  }
  const left = Math.min(Math.max(16, rect.left), vw - width - 16);
  if (rect.top + rect.height + 240 < vh) return { top: rect.top + rect.height + 12, left, width };
  return { top: Math.max(16, rect.top - 232), left, width };
}

/** Spotlight walkthrough of the app. Starts once per person (first visit to Home), replayable from the sidebar. */
export function GuidedTour() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me } = useMe();
  const { open, step, start, close, go } = useTour();
  const current = STEPS[step];
  const onRightPage = !current?.route || pathname === current.route;
  const { rect, missing } = useTargetRect(current?.target, open && onRightPage);
  const nextRef = useRef<HTMLButtonElement>(null);

  // First visit: start automatically once.
  useEffect(() => {
    if (!me || pathname !== "/home") return;
    try {
      if (!localStorage.getItem(storageKey(me.id))) start();
    } catch {
      /* storage blocked: no auto-start */
    }
  }, [me, pathname, start]);

  const finish = useCallback(() => {
    if (me)
      try {
        localStorage.setItem(storageKey(me.id), new Date().toISOString());
      } catch {}
    close();
  }, [me, close]);

  // Navigate to the step's page if needed.
  useEffect(() => {
    if (open && current?.route && pathname !== current.route) router.push(current.route);
  }, [open, current, pathname, router]);

  // A target that never appears (e.g. hidden for viewers): skip the step.
  useEffect(() => {
    if (open && missing) go(Math.min(step + 1, STEPS.length - 1));
  }, [open, missing, step, go]);

  useEffect(() => {
    if (!open) return;
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") {
        if (step < STEPS.length - 1) go(step + 1);
        else finish();
      }
      if (e.key === "ArrowLeft" && step > 0) go(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, go, finish]);

  if (!open || !current) return null;
  const last = step === STEPS.length - 1;
  const waiting = current.target && !rect;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      {/* Dimmed backdrop with a hole cut around the target */}
      <svg className="absolute inset-0 size-full" aria-hidden onClick={finish}>
        <defs>
          <mask id="tour-hole">
            <rect width="100%" height="100%" fill="white" />
            {rect && <rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} rx={14} fill="black" className="transition-all duration-300" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(5,4,10,0.72)" mask="url(#tour-hole)" />
      </svg>
      {rect && (
        <div
          className="pointer-events-none absolute rounded-[14px] ring-2 ring-highlight transition-all duration-300"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          aria-hidden
        />
      )}
      <div
        className="absolute flex flex-col gap-3 rounded-[16px] border border-line bg-surface p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] transition-all duration-300"
        style={{ ...cardPosition(rect), width: Math.min(CARD_W, typeof window === "undefined" ? CARD_W : window.innerWidth - 32), opacity: waiting ? 0 : 1 }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="tour-title" className="flex items-center gap-2 text-[17px] font-semibold">
            {!current.target && <Sparkles className="size-4 text-highlight" aria-hidden />}
            {current.title}
          </h2>
          <button type="button" onClick={finish} aria-label="Close the tour" className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text">
            <X className="size-4" />
          </button>
        </div>
        <p id="tour-body" className="text-[14px] leading-relaxed text-muted">
          {current.body}
        </p>
        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex gap-1" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-4 bg-highlight" : "w-1.5 bg-line"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={() => go(step - 1)}>
                <ArrowLeft /> Back
              </Button>
            )}
            <Button ref={nextRef} size="sm" onClick={() => (last ? finish() : go(step + 1))}>
              {last ? "Finish" : step === 0 ? "Show me" : "Next"} {!last && <ArrowRight />}
            </Button>
          </div>
        </div>
        {step === 0 && (
          <button type="button" onClick={finish} className="self-start text-xs text-faint underline-offset-4 hover:text-text hover:underline">
            Skip the tour
          </button>
        )}
      </div>
    </div>
  );
}
