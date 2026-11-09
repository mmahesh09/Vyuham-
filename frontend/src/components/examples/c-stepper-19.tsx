"use client"

import { useRef, useState } from "react"
import {
  Frame,
  FrameHeader,
  FramePanel,
} from "@/components/reui/frame"
import { IconTile } from "@/components/reui/icon-tile"
import {
  Stepper,
  StepperContent,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
} from "@/components/ui/empty"
import { CheckIcon, MoveRightIcon } from "lucide-react"

const steps = [
  {
    title: "Choose Resolution",
    description: "Pick one of the resolution options",
    empty: "Resolution options appear here",
  },
  {
    title: "Execute Resolution",
    description: "Verify details and proceed",
    empty: "Details to verify appear here",
  },
  {
    title: "Resolution Summary",
    description: "View actions taken",
    empty: "Actions taken appear here",
  },
]

// The frame tile's 1px border, made transparent, plus its 2px inset form the
// 3px ring around a 28px card. The tile also takes the focus ring from the
// pill-shaped trigger, so the ring follows its corners in every style. The
// indicator goes overflow-visible so that ring is not clipped.
const completed = (
  <IconTile
    variant="frame"
    size="sm"
    className="bg-success/20 after:bg-success in-focus-visible:ring-ring/50 border-transparent text-white [--icon-tile-size:--spacing(8.5)] after:border-white/8 after:shadow-sm in-focus-visible:ring-3"
    aria-hidden="true"
  >
    <CheckIcon
    />
  </IconTile>
)

// r=7 gives a circumference of 44: the track is eleven 3+1 dashes and the
// arc is 17 long (139 degrees), starting at 11 o'clock as drawn. Only the arc
// spins, so the dashed track holds still.
function Ring({ spin = false }: { spin?: boolean }) {
  return (
    <IconTile
      variant="frame"
      size="sm"
      className="bg-input/50 after:bg-background after:border-ring/30 in-focus-visible:ring-ring/50 border-transparent [--icon-tile-size:--spacing(8.5)] after:shadow-sm in-focus-visible:ring-3"
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" fill="none" strokeWidth="1.6">
        <circle
          cx="8"
          cy="8"
          r="7"
          pathLength={44}
          strokeDasharray="3 1"
          className="stroke-ring/50"
        />
        {spin && (
          <circle
            cx="8"
            cy="8"
            r="7"
            pathLength={44}
            strokeDasharray="17 27"
            strokeDashoffset="14.4"
            className="stroke-success origin-center motion-safe:animate-spin"
          />
        )}
      </svg>
    </IconTile>
  )
}

const indicators = { completed, inactive: <Ring />, loading: <Ring spin /> }

export function Pattern() {
  const [current, setCurrent] = useState(2)
  const prevRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  // One past the last step marks every step complete. No tab is selected
  // then, so the last one keeps the tablist's tab stop.
  const allDone = current > steps.length

  function goTo(step: number) {
    setCurrent(step)
    // The pressed button disables itself at either end, so focus moves to
    // its partner.
    if (step === 1) nextRef.current?.focus()
    if (step > steps.length) prevRef.current?.focus()
  }

  return (
    <Stepper
      value={current}
      onValueChange={setCurrent}
      indicators={indicators}
      className="@container max-w-175"
      aria-label="Resolution steps"
    >
      <Frame variant="ghost" spacing="sm" className="bg-surface-2 dark:bg-input/50">
        {/* The title keeps text-sm's own 20px line, since truncate clips to
            the line box, and the text-xs subtitle its 16px: py-1 around that
            36px column keeps the drawn 44px bar. The drawn 48px end padding
            is left out so the labels fit the 700px cap; below about 43rem
            they truncate, and under 36rem only the tiles remain, with sr-only
            keeping each label as the tab's name. */}
        <FrameHeader className="px-2.75 py-1">
          <StepperNav>
            {steps.map((item, index) => {
              const step = index + 1

              // The primitive shows loading on the active step only, so every
              // step carries the flag and the spinner follows the selection.
              // flex-auto shares the free width equally, so every arrow keeps
              // the same gap on both sides.
              return (
                <StepperItem
                  key={item.title}
                  step={step}
                  loading
                  className="min-w-0 not-last:flex-auto"
                >
                  <StepperTrigger
                    tabIndex={allDone && step === steps.length ? 0 : undefined}
                    className="min-w-0 gap-2 focus-visible:ring-0"
                  >
                    <StepperIndicator className="size-8.5 overflow-visible bg-transparent data-[state=active]:bg-transparent data-[state=completed]:bg-transparent" />

                    <div className="flex min-w-0 flex-col text-start @max-xl:sr-only">
                      <StepperTitle className="truncate leading-5">
                        {item.title}
                      </StepperTitle>
                      <StepperDescription className="truncate text-xs">
                        {item.description}
                      </StepperDescription>
                      {step < current && (
                        <span className="sr-only">, completed</span>
                      )}
                      {step === current && (
                        <span className="sr-only">, in progress</span>
                      )}
                    </div>
                  </StepperTrigger>

                  {step < steps.length && (
                    <span className="flex flex-1 justify-center px-1.5">
                      <MoveRightIcon className="text-ring/80 size-3.5 shrink-0 rtl:rotate-180" aria-hidden="true" />
                    </span>
                  )}
                </StepperItem>
              )
            })}
          </StepperNav>
        </FrameHeader>

        {/* Empty's padding and description size differ per style, so the
            panel owns the 44px and the description pins text-sm. */}
        <FramePanel className="py-11 shadow-none">
          <StepperPanel>
            {steps.map((item, index) => (
              <StepperContent key={item.title} value={index + 1}>
                <Empty className="p-0">
                  <EmptyHeader>
                    <EmptyDescription className="text-sm">
                      {item.empty}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </StepperContent>
            ))}
            <StepperContent value={steps.length + 1}>
              <Empty className="p-0">
                <EmptyHeader>
                  <EmptyDescription className="text-sm">
                    Resolution complete
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </StepperContent>
          </StepperPanel>

          <div className="mt-3 flex justify-center gap-2">
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
        </FramePanel>
      </Frame>
    </Stepper>
  )
}