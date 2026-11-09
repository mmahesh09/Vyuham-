"use client"

import { useRef, useState } from "react"
import { Badge } from "@/components/reui/badge"
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CheckIcon, CircleDashedIcon, InfoIcon } from "lucide-react"

const stops = [
  { address: "Damrak 12", time: "09:12" },
  { address: "Rokin 75", time: "09:31" },
  { address: "Nieuwezijds 112", time: "09:48" },
  { address: "Spuistraat 210", time: "10:05" },
  { address: "Haarlemmerstraat 44", time: "10:20" },
]

// The 14px ring stays transparent and the 10px dot inside it carries the
// state color, so the 1px gap between them shows whatever surface is behind.
const completed = (
  <span className="bg-success flex size-2.5 items-center justify-center rounded-full text-white">
    <CheckIcon className="size-2" aria-hidden="true" />
  </span>
)

function Pending() {
  return (
    <span className="bg-ring/80 flex size-2.5 items-center justify-center rounded-full text-white">
      <CircleDashedIcon className="size-2" aria-hidden="true" />
    </span>
  )
}

// The current step trades its solid ring for a dashed track with a 2px green
// arc spinning over it, inset so the arc stays inside the box and 1px clear
// of the dot. pathLength={44} counts the ring as 44 units, so the track closes
// in eleven 3+1 dashes at any size; only the arc moves.
function Current() {
  return (
    <span className="relative flex size-3.5 items-center justify-center">
      <svg
        viewBox="0 0 14 14"
        fill="none"
        strokeWidth="1"
        aria-hidden="true"
        className="absolute inset-0 size-full"
      >
        <circle
          cx="7"
          cy="7"
          r="6"
          pathLength={44}
          strokeDasharray="3 1"
          className="stroke-ring/50"
        />
        <circle
          cx="7"
          cy="7"
          r="6"
          pathLength={44}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="15 29"
          className="stroke-success origin-center motion-safe:animate-spin"
        />
      </svg>
      <span className="bg-ring/80 size-2 rounded-full" />
    </span>
  )
}

const indicators = {
  completed,
  inactive: <Pending />,
  loading: <Current />,
}

export function Pattern() {
  const [current, setCurrent] = useState(3)
  const prevRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  // One past the last step marks every step complete. No tab is selected
  // then, so the last one keeps the tablist's tab stop.
  const allDone = current > stops.length

  function goTo(step: number) {
    setCurrent(step)
    // The pressed button disables itself at either end, so focus moves to
    // its partner.
    if (step === 1) nextRef.current?.focus()
    if (step > stops.length) prevRef.current?.focus()
  }

  return (
    <div className="@container mx-auto w-full max-w-lg">
      <Stepper
        value={current}
        onValueChange={setCurrent}
        orientation="vertical"
        indicators={indicators}
        className="flex flex-col gap-6 @md:flex-row @md:items-start"
        aria-label="Delivery route"
      >
        {/* A fixed width, not the natural one: the badge moves with the
            current stop, so a natural width would shift the content and the
            buttons under the pointer on every step. */}
        <StepperNav className="w-full max-w-60 shrink-0 gap-2.5">
          {stops.map((stop, index) => {
            const step = index + 1
            const status =
              step < current
                ? `Arrived at ${stop.time}`
                : step === current
                  ? "On time"
                  : `Expected at ${stop.time}`

            // The primitive shows loading on the active stop only, so every
            // stop carries the flag and the spinner stands in for an active
            // indicator. Each row is 20px (the badge's height) with or without
            // the badge, so the separators sit at one fixed offset.
            return (
              <StepperItem
                key={stop.address}
                step={step}
                loading
                className="relative min-h-5 justify-start gap-1.5 group-data-[orientation=vertical]/stepper-nav:flex-row"
              >
                {/* after: grows the 14px trigger to a 24px hit area without
                    changing the 20px row the separators are placed on. */}
                <StepperTrigger
                  tabIndex={allDone && step === stops.length ? 0 : undefined}
                  className="relative gap-1.5 after:absolute after:inset-x-0 after:-inset-y-1.25"
                >
                  <StepperIndicator className="border-ring/80 data-[state=completed]:border-success size-3.5 border bg-transparent data-[state=active]:border-0 data-[state=active]:bg-transparent data-[state=completed]:bg-transparent" />
                  <StepperTitle>{stop.address}</StepperTitle>
                  <span className="sr-only">, {status}</span>
                </StepperTrigger>

                {/* The tab already announces the status, so the badge and the
                    info icon are hidden from assistive tech and the icon stays
                    pointer-only, keeping one tab stop in the tablist. */}
                {step === current ? (
                  <Badge
                    variant="success-light"
                    radius="full"
                    aria-hidden="true"
                  >
                    {status}
                  </Badge>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      tabIndex={-1}
                      aria-hidden="true"
                      className="flex"
                    >
                      <InfoIcon className="text-muted-foreground hover:text-foreground size-3.5" aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent>{status}</TooltipContent>
                  </Tooltip>
                )}

                {/* Three 3px dots, a gradient cut by a repeating dot mask.
                    data-state greens the top once this stop is done; the
                    bottom follows only when the next stop is done too. */}
                {step < stops.length && (
                  <StepperSeparator
                    className={cn(
                      "from-ring/80 to-ring/80 data-[state=completed]:from-success pointer-events-none absolute start-1.75 top-4.5 m-0 -translate-x-1/2 bg-transparent bg-linear-to-b to-70% mask-[radial-gradient(circle_closest-side,#000_90%,transparent)] mask-size-[0.1875rem_0.3125rem] mask-center group-data-[orientation=vertical]/stepper-nav:h-3.5 group-data-[orientation=vertical]/stepper-nav:w-0.75 rtl:translate-x-1/2",
                      step + 1 < current
                        ? "to-success"
                        : "data-[state=completed]:to-ring"
                    )}
                  />
                )}
              </StepperItem>
            )
          })}
        </StepperNav>

        {/* Decorative, so hidden from assistive tech: a line across while the
            columns stack, a line between them once they sit side by side. */}
        <Separator aria-hidden="true" className="@md:hidden" />
        <Separator
          aria-hidden="true"
          orientation="vertical"
          className="hidden @md:block"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3 text-start">
          <StepperPanel>
            {stops.map((stop, index) => (
              <StepperContent key={stop.address} value={index + 1}>
                <p className="text-sm font-medium">{stop.address}</p>
                <p className="text-muted-foreground text-sm">
                  Stop {index + 1} of {stops.length}, due at {stop.time}
                </p>
              </StepperContent>
            ))}
            <StepperContent value={stops.length + 1}>
              <p className="text-sm font-medium">Route complete</p>
              <p className="text-muted-foreground text-sm">
                All {stops.length} stops delivered
              </p>
            </StepperContent>
          </StepperPanel>
          <div className="flex justify-start gap-2">
            <Button
              ref={prevRef}
              variant="outline"
              size="sm"
              disabled={current === 1}
              onClick={() => goTo(current - 1)}
            >
              Previous
            </Button>
            <Button
              ref={nextRef}
              variant="outline"
              size="sm"
              disabled={allDone}
              onClick={() => goTo(current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Stepper>
    </div>
  )
}